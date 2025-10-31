package com.codecafe.backend.service;

import com.codecafe.backend.dto.DefaultFileDTO;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.stream.Stream;

/**
 * Service that loads the default project files from a local repository directory.
 */
@Service
public class DefaultFileService {

    private static final Logger log = LoggerFactory.getLogger(DefaultFileService.class);
    private final Path repositoryRoot;

    public DefaultFileService(
        @Value("${codecafe.default-files.repository-path:${CODECAFE_DEFAULT_FILES_REPOSITORY_PATH:}}")
        String repositoryPath) {
        if (repositoryPath == null || repositoryPath.isBlank()) {
            this.repositoryRoot = null;
            log.warn("No repository path configured for default files. Falling back to in-app defaults.");
        } else {
            this.repositoryRoot = Paths.get(repositoryPath).toAbsolutePath().normalize();
            log.info("Default files repository path set to: {}", this.repositoryRoot);
        }
    }

    public List<DefaultFileDTO> loadDefaultFiles() {
        if (repositoryRoot == null) {
            throw new IllegalStateException("Default files repository path is not configured.");
        }

        if (!Files.exists(repositoryRoot) || !Files.isDirectory(repositoryRoot)) {
            throw new IllegalStateException(
                String.format("Default files repository path does not exist or is not a directory: %s", repositoryRoot)
            );
        }

        List<DefaultFileDTO> files = new ArrayList<>();
    try (Stream<Path> stream = Files.list(repositoryRoot)) {
            stream
                .filter(Files::isRegularFile)
                .map(this::mapToDefaultFile)
                .filter(Objects::nonNull)
                .forEach(files::add);
        } catch (IOException ioException) {
            throw new IllegalStateException(
                String.format("Failed to read default files from %s", repositoryRoot),
                ioException
            );
        }

        return files;
    }

    private DefaultFileDTO mapToDefaultFile(Path filePath) {
        try {
            String relativeName = repositoryRoot.relativize(filePath).toString().replace('\\', '/');
            String content = Files.readString(filePath);
            String language = inferLanguage(relativeName);
            return new DefaultFileDTO(relativeName, relativeName, language, content);
        } catch (IOException ioException) {
            log.warn("Skipping default file {} due to read error: {}", filePath, ioException.getMessage());
            return null;
        }
    }

    private String inferLanguage(String fileName) {
        String normalized = fileName.toLowerCase(Locale.ROOT);
        if (normalized.endsWith(".html")) {
            return "html";
        }
        if (normalized.endsWith(".css")) {
            return "css";
        }
        if (normalized.endsWith(".tsx") || normalized.endsWith(".ts")) {
            return "typescript";
        }
        if (normalized.endsWith(".jsx") || normalized.endsWith(".js")) {
            return "javascript";
        }
        if (normalized.endsWith(".json")) {
            return "json";
        }
        if (normalized.endsWith(".md")) {
            return "markdown";
        }
        if (normalized.endsWith(".py")) {
            return "python";
        }
        if (normalized.endsWith(".java")) {
            return "java";
        }
        if (normalized.endsWith(".go")) {
            return "go";
        }
        if (normalized.endsWith(".rs")) {
            return "rust";
        }
        if (normalized.endsWith(".rb")) {
            return "ruby";
        }
        if (normalized.endsWith(".c")) {
            return "c";
        }
        if (normalized.endsWith(".cpp") || normalized.endsWith(".cc") || normalized.endsWith(".cxx")) {
            return "cplusplus";
        }
        return "plaintext";
    }
}
