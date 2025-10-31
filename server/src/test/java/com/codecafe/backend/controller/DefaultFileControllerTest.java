package com.codecafe.backend.controller;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.codecafe.backend.dto.DefaultFileDTO;
import com.codecafe.backend.service.DefaultFileService;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = DefaultFileController.class)
class DefaultFileControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private DefaultFileService defaultFileService;

    @Test
    @DisplayName("GET /api/files/defaults returns repository files")
    void getDefaultFilesReturnsRepositoryFiles() throws Exception {
        List<DefaultFileDTO> files = List.of(
                new DefaultFileDTO("index.html", "index.html", "html", "<html></html>"),
                new DefaultFileDTO("style.css", "style.css", "css", "body{}"));
        when(defaultFileService.loadDefaultFiles()).thenReturn(files);

        mockMvc.perform(get("/api/files/defaults"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].id", equalTo("index.html")))
                .andExpect(jsonPath("$[1].id", equalTo("style.css")));
    }

    @Test
    @DisplayName("GET /api/files/defaults returns empty list when repository unavailable")
    void getDefaultFilesReturnsEmptyListWhenUnavailable() throws Exception {
        when(defaultFileService.loadDefaultFiles())
                .thenThrow(new IllegalStateException("not configured"));

        mockMvc.perform(get("/api/files/defaults"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$", hasSize(0)));
    }
}