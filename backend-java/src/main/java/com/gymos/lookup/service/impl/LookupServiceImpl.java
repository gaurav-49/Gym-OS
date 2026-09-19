package com.gymos.lookup.service.impl;

import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.gymos.lookup.dao.LookupDao;
import com.gymos.lookup.service.LookupService;

@Service
public class LookupServiceImpl implements LookupService {

    private final LookupDao lookupDao;

    public LookupServiceImpl(LookupDao lookupDao) {
        this.lookupDao = lookupDao;
    }

    @Override
    public List<Map<String, Object>> listExceptions(String module) {
        return lookupDao.listExceptions(module);
    }
}
