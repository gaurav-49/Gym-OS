package com.gymos;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.support.SpringBootServletInitializer;

/**
 * GYM OS backend — Spring Boot 4 / Spring Framework 7 / Jackson 3.
 * Layered modules: controller -> service -> dao, all behind the same /api contract.
 *
 * Extends SpringBootServletInitializer so the same artifact runs two ways:
 *   - as a standalone executable WAR:  java -jar gym-backend-java-<v>.war
 *   - deployed to an external server (Tomcat 11, Jakarta EE 11): drop the WAR
 *     into webapps/ as ROOT.war — it serves the built React UI at / and the
 *     /api endpoints on the same origin.
 */
@SpringBootApplication
public class GymApplication extends SpringBootServletInitializer {

    public static void main(String[] args) {
        SpringApplication.run(GymApplication.class, args);
    }

    @Override
    protected SpringApplicationBuilder configure(SpringApplicationBuilder application) {
        return application.sources(GymApplication.class);
    }
}
