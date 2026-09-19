package com.gymos.tasks.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.common.security.AuthUser;
import com.gymos.tasks.service.TaskService;

/** The staff task queue. Open to any signed-in staff — it is their work list. */
@RestController
@RequestMapping("/api/tasks")
public class TaskController {

    private final TaskService taskService;

    public TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    /** @param due {@code overdue}, {@code today} or {@code week} */
    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String status,
                                          @RequestParam(required = false) String category,
                                          @RequestParam(name = "assigned_to", required = false) Long assignedTo,
                                          @RequestParam(name = "member_id", required = false) Long memberId,
                                          @RequestParam(required = false) String due,
                                          @RequestParam(required = false) String limit) {
        return taskService.list(status, category, assignedTo, memberId, due, limit);
    }

    /** Open / overdue / due-today counts. Pass {@code mine=true} to scope to yourself. */
    @GetMapping("/counts")
    public Map<String, Object> counts(@RequestParam(required = false) String mine,
                                      @AuthenticationPrincipal AuthUser user) {
        Long scope = "true".equals(mine) && user != null ? user.id() : null;
        return taskService.counts(scope);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(taskService.create(body, user == null ? null : user.id()));
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return taskService.update(id, body);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        return taskService.delete(id);
    }
}
