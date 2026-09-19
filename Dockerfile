# GYM OS 2.0 — one image serving both portals.
#
# The admin/staff portal and the member portal are the same React bundle on the
# same origin (staff at /, members at /#/member), served by Spring Boot out of
# the WAR. There is one thing to build and one thing to run.
#
#   docker build -t gym-os .
#   docker run -p 8080:8080 -e DB_HOST=... gym-os

# ---------------------------------------------------------------- the React app
FROM node:22-alpine AS ui
WORKDIR /ui

# package.json first: this layer is rebuilt only when dependencies change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------- the WAR
# Java 25: the version the pom targets (<java.version>). The Maven wrapper
# fetches Maven itself, so no maven+JDK 25 base image is needed.
FROM eclipse-temurin:25-jdk AS build
WORKDIR /src/backend-java

# Wrapper and pom first, so the dependency download is cached independently of
# source edits. go-offline is a cache warm-up: a miss costs a slower build, not
# a broken one, so it must not fail the image.
COPY backend-java/.mvn .mvn
COPY backend-java/mvnw backend-java/pom.xml ./
RUN ./mvnw -B -ntp -Dskip.ui=true dependency:go-offline || true

COPY backend-java/src src

# The UI is already built above. The pom's copy-ui step reads ../frontend/dist,
# so drop it there and skip the npm run the pom would otherwise do itself
# (-Dskip.ui=true) — this image has no Node in the Java stage.
COPY --from=ui /ui/dist /src/frontend/dist
RUN ./mvnw -B -ntp -Dskip.ui=true -DskipTests package

# ---------------------------------------------------------------- runtime
FROM eclipse-temurin:25-jre
# curl is the container healthcheck's only dependency.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Never run the gym's data as root.
RUN useradd --system --create-home --uid 10001 gymos
WORKDIR /app
COPY --from=build /src/backend-java/target/*.war /app/gym-os.war
USER gymos

EXPOSE 8080

# MaxRAMPercentage rather than a fixed -Xmx: the heap then follows whatever
# mem_limit compose gives the container, including on a 1 GB Oracle micro.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+UseSerialGC"

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
    CMD curl -fsS http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/gym-os.war"]
