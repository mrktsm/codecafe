package com.codecafe.backend.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.codecafe.backend.dto.DefaultFileDTO;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DefaultFileServiceTest {

    @TempDir
    Path tempDir;

    private Path htmlFile;
    private Path cssFile;

    @BeforeEach
    void setUp() throws IOException {
        htmlFile = tempDir.resolve("index.html");
        Files.writeString(htmlFile, "<html></html>");

        cssFile = tempDir.resolve("style.css");
        Files.writeString(cssFile, "body { color: #000; }");

        Files.createDirectory(tempDir.resolve("nested"));
    }

    @Test
    @DisplayName("loadDefaultFiles returns files with inferred languages")
    void loadDefaultFilesReturnsFiles() {
        DefaultFileService service = new DefaultFileService(tempDir.toString());

        List<DefaultFileDTO> files = service.loadDefaultFiles();

        assertThat(files)
                .hasSize(2)
                .extracting(DefaultFileDTO::getId, DefaultFileDTO::getLanguage)
                .containsExactlyInAnyOrder(
                        org.assertj.core.groups.Tuple.tuple("index.html", "html"),
                        org.assertj.core.groups.Tuple.tuple("style.css", "css"));

        assertThat(files)
                .extracting(DefaultFileDTO::getContent)
                .contains("<html></html>", "body { color: #000; }");
    }

    @Test
    @DisplayName("loadDefaultFiles throws when repository path is not configured")
    void loadDefaultFilesThrowsWhenPathMissing() {
        DefaultFileService service = new DefaultFileService("");

        IllegalStateException exception = assertThrows(IllegalStateException.class, service::loadDefaultFiles);

        assertThat(exception.getMessage())
                .contains("Default files repository path is not configured");
    }

    @Test
    @DisplayName("loadDefaultFiles throws when repository path is invalid")
    void loadDefaultFilesThrowsWhenPathInvalid() {
        DefaultFileService service = new DefaultFileService(tempDir.resolve("missing").toString());

        IllegalStateException exception = assertThrows(IllegalStateException.class, service::loadDefaultFiles);

        assertThat(exception.getMessage())
                .contains("does not exist or is not a directory");
    }
}