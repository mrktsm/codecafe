package com.codecafe.backend.controller;

import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.stereotype.Controller;
import com.codecafe.backend.dto.CursorMessage;

@Controller
public class CursorController {

    @MessageMapping("/cursor")
    @SendTo("/topic/cursors")
    public CursorMessage handleCursor(CursorMessage message) {
        // You can update the aggregated cursor state here (if needed)
        return message;
    }
}