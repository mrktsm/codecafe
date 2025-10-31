package com.codecafe.backend.controller;

import com.codecafe.backend.dto.DefaultFileDTO;
import com.codecafe.backend.service.DefaultFileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collections;
import java.util.List;

@RestController
@RequestMapping("/api/files")
public class DefaultFileController {

    private static final Logger log = LoggerFactory.getLogger(DefaultFileController.class);
    private final DefaultFileService defaultFileService;

    public DefaultFileController(DefaultFileService defaultFileService) {
        this.defaultFileService = defaultFileService;
    }

    @GetMapping("/defaults")
    public ResponseEntity<List<DefaultFileDTO>> getDefaultFiles() {
        try {
            List<DefaultFileDTO> files = defaultFileService.loadDefaultFiles();
            return ResponseEntity.ok(files);
        } catch (IllegalStateException ex) {
            log.warn("Default files are unavailable: {}", ex.getMessage());
            return ResponseEntity.ok(Collections.emptyList());
        }
    }
}
