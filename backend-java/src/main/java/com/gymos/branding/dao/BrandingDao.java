package com.gymos.branding.dao;

import java.util.Map;

/** Branding is stored as rows in the shared key/value {@code settings} table. */
public interface BrandingDao {

    /** @return every {@code brand_*} setting, keyed without the prefix */
    Map<String, String> load();

    /** Upsert one branding field. */
    void save(String key, String value);
}
