package com.gymos.branches.service.impl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.branches.dao.BranchDao;
import com.gymos.branches.dao.impl.BranchDaoImpl;
import com.gymos.branches.service.BranchService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Names;

@Service
public class BranchServiceImpl implements BranchService {

    private static final Pattern CODE = Pattern.compile("^[A-Z0-9]{2,20}$");

    /** The branch every record falls back to. It can never be deleted or deactivated. */
    private static final String MAIN_CODE = "MAIN";

    private final BranchDao branchDao;
    private final AuditService audit;

    public BranchServiceImpl(BranchDao branchDao, AuditService audit) {
        this.branchDao = branchDao;
        this.audit = audit;
    }

    @Override
    public List<Map<String, Object>> list() {
        return branchDao.findBranches();
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body) {
        String name = trimmed(body, "name");
        if (name.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Branch name is required");
        }
        String rawCode = trimmed(body, "code");
        if (rawCode.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Branch code is required");
        }
        String code = rawCode.toUpperCase();
        if (!CODE.matcher(code).matches()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Branch code must be 2–20 letters or digits (no spaces or symbols)");
        }

        branchDao.findClash(code, name).ifPresent(clash -> {
            throw new BusinessException(HttpStatus.CONFLICT,
                code.equals(String.valueOf(clash.get("code")))
                    ? "Branch code " + code + " is already used by \"" + clash.get("name") + "\"."
                    : "A branch named \"" + clash.get("name") + "\" already exists.");
        });

        Map<String, Object> branch = branchDao.insert(Names.titleCase(name), code,
            Names.titleCase(Body.str(body, "address")), Body.str(body, "phone"),
            Body.str(body, "email"), Body.str(body, "gst_number"));
        audit.record("create", "branches", branch.get("id"),
            "Added branch \"" + branch.get("name") + "\" (" + code + ")");
        return branch;
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        Map<String, Object> existing = branchDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Branch not found"));

        String name = body.containsKey("name") ? trimmed(body, "name") : null;
        if (body.containsKey("name") && name.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Branch name is required");
        }

        Boolean isActive = body.containsKey("is_active") ? Body.bool(body, "is_active") : null;
        if (Boolean.FALSE.equals(isActive) && MAIN_CODE.equals(String.valueOf(existing.get("code")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "The main branch cannot be deactivated.");
        }

        if (name != null && !name.equals(String.valueOf(existing.get("name")))) {
            String candidate = name;
            branchDao.findByNameExcluding(candidate, id).ifPresent(clash -> {
                throw new BusinessException(HttpStatus.CONFLICT,
                    "A branch named \"" + candidate + "\" already exists.");
            });
        }

        Map<String, Object> updated = branchDao.update(id, Names.titleCase(name),
            body.containsKey("address") ? Names.titleCase(Body.str(body, "address")) : null,
            body.containsKey("phone") ? Body.str(body, "phone") : null,
            body.containsKey("email") ? Body.str(body, "email") : null,
            body.containsKey("gst_number") ? Body.str(body, "gst_number") : null,
            isActive);
        audit.record("update", "branches", id, "Updated branch \"" + updated.get("name") + "\"");
        return updated;
    }

    @Override
    public Map<String, Object> delete(Long id) {
        Map<String, Object> branch = branchDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Branch not found"));
        String name = String.valueOf(branch.get("name"));

        if (MAIN_CODE.equals(String.valueOf(branch.get("code")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "The main branch cannot be deleted — every record falls back to it.");
        }
        // Deleting a branch that still owns rows would orphan them, so say what
        // is in the way rather than cascading.
        for (String table : BranchDaoImpl.BRANCHED_TABLES) {
            int n = branchDao.countRowsIn(table, id);
            if (n > 0) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "\"" + name + "\" still has " + n + " " + table + " record(s). "
                        + "Move them to another branch, or deactivate this branch instead.");
            }
        }
        branchDao.delete(id);
        audit.record("delete", "branches", id, "Deleted branch \"" + name + "\"");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Branch \"" + name + "\" deleted.");
        out.put("branch", branch);
        return out;
    }

    private static String trimmed(Map<String, Object> body, String key) {
        String v = Body.str(body, key);
        return v == null ? "" : v.trim();
    }
}
