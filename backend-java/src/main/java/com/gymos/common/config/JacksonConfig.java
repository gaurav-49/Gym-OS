package com.gymos.common.config;

import java.sql.Date;

import org.springframework.boot.jackson.autoconfigure.JsonMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import tools.jackson.core.JsonGenerator;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.StdSerializer;

/**
 * Mirrors the Node backend's pg type parser: backend/src/config/db.js registers
 * `types.setTypeParser(types.builtins.DATE, v => v)`, so DATE columns come back
 * as plain `YYYY-MM-DD` strings. The frontend relies on that (e.g. fmtDate does
 * `new Date(d + 'T00:00:00')`), so java.sql.Date values (DATE columns read via
 * JDBC) must serialize as date-only strings too. TIMESTAMP/TIME columns
 * (java.sql.Timestamp / java.sql.Time) keep their default full-ISO form, which
 * matches what the Node backend returned for those types.
 */
@Configuration
public class JacksonConfig {

    @Bean
    JsonMapperBuilderCustomizer sqlDateAsStringCustomizer() {
        SimpleModule module = new SimpleModule("sql-date-as-string");
        module.addSerializer(Date.class, new StdSerializer<>(Date.class) {
            @Override
            public void serialize(Date value, JsonGenerator gen, SerializationContext ctxt)
                    throws JacksonException {
                gen.writeString(value.toLocalDate().toString()); // yyyy-MM-dd
            }
        });
        return builder -> builder.addModule(module);
    }
}
