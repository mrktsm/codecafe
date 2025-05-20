import { useState, useEffect, useRef, useCallback } from "react";
import SockJS from "sockjs-client";
import Stomp from "stompjs";
import {
  TextOperation,
  MonacoAdapter,
  OTSelection,
  Client,
  IClientCallbacks,
  offsetToPosition,
} from "../ot/TextOperationSystem";
import {
  RemoteUser,
  UseCollaborationSessionProps,
  UseCollaborationSessionReturn,
} from "../types/props";

interface CursorMessage {
  documentId: string;
  sessionId: string;
  userInfo: {
    id: string;
    name: string;
    color: string;
    cursorPosition: { lineNumber: number; column: number } | null;
    selection: { ranges: { anchor: number; head: number }[] } | null;
  };
}

// Add chat message interface
interface ChatMessagePayload {
  sessionId: string;
  userId: string;
  userName: string;
  userColor: string;
  message: string;
  timestamp?: string;
}

export const useCollaborationSession = ({
  sessionId,
  userId,
  userInfo,
  activeFileId,
  editorInstance,
  isSessionActive,
  onStateReceived,
  onOperationReceived,
  onRemoteUsersUpdate,
  onConnectionStatusChange,
  onError,
  onChatMessageReceived,
  webViewFileIds,
}: UseCollaborationSessionProps): UseCollaborationSessionReturn => {
  const [isConnected, setIsConnected] = useState(false);
  const stompClientRef = useRef<Stomp.Client | null>(null);
  const adapterRef = useRef<MonacoAdapter | null>(null);
  const clientRef = useRef<Client | null>(null);
  const subscriptionsRef = useRef<Stomp.Subscription[]>([]);
  const currentFileIdRef = useRef<string | null>(null);
  const subscribedWebViewOpsRef = useRef<Set<string>>(new Set());

  const handleConnectionStatusChange = useCallback(
    (connected: boolean) => {
      setIsConnected(connected);
      onConnectionStatusChange?.(connected);
    },
    [onConnectionStatusChange]
  );

  const handleError = useCallback(
    (error: Error | string) => {
      console.error("[useCollaborationSession] Error:", error);
      onError?.(error);
      handleConnectionStatusChange(false);
      // Reset OT state on error
      clientRef.current = null;
      adapterRef.current?.detach();
      adapterRef.current = null;
      subscriptionsRef.current = [];
    },
    [onError, handleConnectionStatusChange]
  );

  useEffect(() => {
    if (!isSessionActive || !sessionId || !activeFileId || !editorInstance) {
      if (stompClientRef.current?.connected) {
        stompClientRef.current.disconnect(() => {
          handleConnectionStatusChange(false);
          clientRef.current = null;
          adapterRef.current?.detach();
          adapterRef.current = null;
          subscriptionsRef.current = []; // Clear subscriptions on disconnect
        }, {});
      } else if (isConnected) {
        handleConnectionStatusChange(false);
      }
      currentFileIdRef.current = null;
      return;
    }

    // If already connected and handling the same file, do nothing
    if (isConnected && currentFileIdRef.current === activeFileId) {
      return;
    }

    currentFileIdRef.current = activeFileId; // Track the file we are connecting for

    // Unsubscribe from previous file topics if any
    subscriptionsRef.current.forEach((sub) => {
      try {
        sub.unsubscribe();
      } catch {
        // Ignore unsubscription errors
      }
    });
    subscriptionsRef.current = [];

    // Do NOT disconnect if we're connecting for the *first* time in this hook instance
    if (stompClientRef.current?.connected) {
      stompClientRef.current.disconnect(() => {
        clientRef.current = null;
        adapterRef.current?.detach();
        adapterRef.current = null;
      }, {});
    } else {
      // If not connected, still ensure OT state is reset
      clientRef.current = null;
      adapterRef.current?.detach();
      adapterRef.current = null;
    }

    const socketUrl = import.meta.env.VITE_BACKEND_URL + "/ws";
    const socket = new SockJS(socketUrl);
    const stompClient = Stomp.over(socket);
    stompClient.debug = () => {}; // Suppress STOMP debug logs in console
    stompClientRef.current = stompClient;

    // Ensure the editor model is ready before creating the adapter
    const editorModel = editorInstance?.getModel();
    if (editorInstance && editorModel && !adapterRef.current) {
      adapterRef.current = new MonacoAdapter(editorInstance);
    } else if (editorInstance && editorModel && adapterRef.current) {
      adapterRef.current.detach();
      adapterRef.current = new MonacoAdapter(editorInstance);
    } else if (!editorModel) {
      // Log a warning or handle the case where the model isn't ready yet
      console.warn(
        "[useCollaborationSession] Editor model not ready when trying to initialize adapter for file:",
        activeFileId
      );
      // Potentially retry after a short delay or wait for an event indicating model readiness
    }

    stompClient.connect(
      {},
      () => {
        handleConnectionStatusChange(true);

        const joinPayload = {
          sessionId: sessionId,
          documentId: activeFileId,
          userId: userId,
          userName: userInfo.name.trim(),
          userColor: userInfo.color,
        };
        stompClient.send("/app/join", {}, JSON.stringify(joinPayload));

        // Small delay to allow server to process join before fetching state
        setTimeout(() => {
          // Request initial state FOR THE CURRENT ACTIVE FILE and WEBVIEW FILES
          const filesToRequest = new Set<string>([activeFileId]);
          webViewFileIds?.forEach((id) => filesToRequest.add(id));

          filesToRequest.forEach((fileId) => {
            if (stompClientRef.current?.connected) {
              // Check connection again before sending
              stompClientRef.current.send(
                "/app/get-document-state",
                {},
                JSON.stringify({ documentId: fileId, sessionId: sessionId })
              );
            }
          });
        }, 250); // 250ms delay, adjust as needed

        const clientCallbacks: IClientCallbacks = {
          sendOperation: (revision: number, operation: TextOperation) => {
            if (
              stompClientRef.current?.connected &&
              sessionId &&
              currentFileIdRef.current &&
              editorInstance
            ) {
              // Get current selection and cursor position from the editor
              const currentSelection = adapterRef.current?.getSelection();
              let cursorPosition: {
                lineNumber: number;
                column: number;
              } | null = null;
              const editorPosition = editorInstance.getPosition();
              if (editorPosition) {
                cursorPosition = {
                  lineNumber: editorPosition.lineNumber,
                  column: editorPosition.column,
                };
              }

              const payload = {
                documentId: currentFileIdRef.current,
                clientId: userId,
                revision: revision,
                operation: operation.toJSON(),
                sessionId: sessionId,
                // Bundle selection and cursor position
                selection: currentSelection?.toJSON() ?? null,
                cursorPosition: cursorPosition,
              };
              stompClientRef.current.send(
                "/app/operation",
                {},
                JSON.stringify(payload)
              );
            } else {
              // Connection not available, silently fail
            }
          },
          // Re-enable sendSelection for explicit selection changes
          sendSelection: (selection: OTSelection | null) => {
            if (
              stompClientRef.current?.connected &&
              sessionId &&
              currentFileIdRef.current &&
              userInfo.name.trim() &&
              editorInstance // Need editorInstance to get current cursor position
            ) {
              // Get current cursor position ONLY if selection is NOT null (i.e., not a blur event)
              let currentCursorPosition: {
                lineNumber: number;
                column: number;
              } | null = null;

              if (selection !== null) {
                // Only get position if it's not a blur
                const editorPosition = editorInstance.getPosition();
                if (editorPosition) {
                  currentCursorPosition = {
                    lineNumber: editorPosition.lineNumber,
                    column: editorPosition.column,
                  };
                }
              } // If selection is null, currentCursorPosition remains null

              // Construct the payload for the /app/selection endpoint
              const payload: CursorMessage = {
                documentId: currentFileIdRef.current,
                sessionId: sessionId,
                userInfo: {
                  id: userId,
                  name: userInfo.name.trim(),
                  color: userInfo.color,
                  cursorPosition: currentCursorPosition,
                  selection: selection?.toJSON() ?? null,
                },
              };

              // Send to the dedicated selection endpoint
              stompClientRef.current.send(
                "/app/selection",
                {},
                JSON.stringify(payload)
              );
            } else {
              // Log if unable to send
              // console.warn("[sendSelection] Cannot send selection - conditions not met.");
            }
          },
          applyOperation: (operation: TextOperation) => {
            adapterRef.current?.applyOperation(operation);

            if (currentFileIdRef.current) {
              onOperationReceived(currentFileIdRef.current, operation);
            }
          },
          getSelection: () => {
            return adapterRef.current?.getSelection() ?? null;
          },
          setSelection: (selection: OTSelection | null) => {
            adapterRef.current?.setSelection(selection);
          },
        };

        // Subscribe to topics for the *current* active file AND webview files
        const currentFileId = activeFileId;
        const newSubscriptions: Stomp.Subscription[] = [];
        const filesToSubscribeState = new Set<string>([
          currentFileId,
          ...(webViewFileIds || []),
        ]);

        // Add chat message subscription
        if (sessionId) {
          const chatTopic = `/topic/sessions/${sessionId}/chat`;
          console.log("[Chat] Subscribing to chat topic:", chatTopic);
          newSubscriptions.push(
            stompClient.subscribe(chatTopic, (message: any) => {
              try {
                const chatMessage = JSON.parse(message.body);
                console.log("[Chat] Received chat message:", chatMessage);
                if (chatMessage && onChatMessageReceived) {
                  onChatMessageReceived(chatMessage);
                }
              } catch (error) {
                console.error("[Chat] Error processing chat message:", error);
              }
            })
          );
        }

        const handleIncomingState = (message: any) => {
          try {
            const state = JSON.parse(message.body);
            const docId = state.documentId;

            if (!docId) {
              console.error(
                "[State Handler] Invalid state message, missing documentId:",
                message.body
              );
              return;
            }

            // Process participants for this document
            let processedParticipants: RemoteUser[] = [];
            if (state.participants && Array.isArray(state.participants)) {
              processedParticipants = state.participants
                .map((p: any): RemoteUser | null => {
                  if (!p || typeof p.id !== "string") return null;
                  return {
                    id: p.id,
                    name: p.name || `User ${p.id.substring(0, 4)}`,
                    color: p.color || "#CCCCCC",
                    cursorPosition: p.cursorPosition || null,
                    selection: p.selection
                      ? OTSelection.fromJSON(p.selection)
                      : null,
                  };
                })
                .filter(
                  (user: RemoteUser | null): user is RemoteUser =>
                    user !== null && user.id !== userId
                );
            }
            // Always update participants state via callback
            onRemoteUsersUpdate(docId, processedParticipants);

            // Always notify App component of the received state to update Zustand
            onStateReceived(
              docId,
              state.document,
              state.revision,
              processedParticipants
            );

            // --- OT Client Initialization & Editor Update (ONLY for the ACTIVE file) ---
            if (docId === currentFileIdRef.current) {
              // Initialize OT Client only if it doesn't exist for this specific file connection instance
              if (!clientRef.current) {
                clientRef.current = new Client(
                  state.revision,
                  userId,
                  clientCallbacks
                );

                // Directly update the Monaco Editor via the Adapter
                if (adapterRef.current && editorInstance) {
                  const currentEditorValue = editorInstance
                    .getModel()
                    ?.getValue();
                  if (currentEditorValue !== state.document) {
                    adapterRef.current.ignoreNextChange = true; // Prevent loopback
                    try {
                      // Use setValue to ensure entire content is replaced correctly
                      editorInstance.getModel()?.setValue(state.document);
                    } catch (error) {
                      console.error(
                        `[State Handler] Error setting editor value for ${docId}:`,
                        error
                      );
                      adapterRef.current.ignoreNextChange = false; // Ensure flag is reset on error
                    } finally {
                      // It's generally safer to reset the flag shortly after the operation
                      // Monaco might trigger changes asynchronously
                      setTimeout(() => {
                        if (adapterRef.current)
                          adapterRef.current.ignoreNextChange = false;
                      }, 0);
                    }
                  }
                }

                // Register OT callbacks *after* client is initialized and editor potentially updated
                if (adapterRef.current) {
                  adapterRef.current.registerCallbacks({
                    change: (op: TextOperation) => {
                      clientRef.current?.applyClient(op);
                    },
                    selectionChange: () => {
                      clientRef.current?.selectionChanged();
                    },
                    blur: () => {
                      clientRef.current?.blur();
                    },
                  });
                }
              } else {
                // If OT client *already* exists for this active file connection,
                // we might still need to handle edge cases or reconciliation,
                // but the primary state update happened via onStateReceived.
                // For now, we only initialized the client once per connection instance.
              }
            }
            // --- End OT Client & Editor Handling ---
          } catch (error) {
            handleError(
              `Error processing document-state message: ${
                error instanceof Error ? error.message : String(error)
              } Message: ${message.body}`
            );
          }
        };

        // Subscribe to state topics for all relevant files
        filesToSubscribeState.forEach((fileId) => {
          const stateTopic = `/topic/sessions/${sessionId}/state/document/${fileId}`;
          newSubscriptions.push(
            stompClient.subscribe(stateTopic, handleIncomingState)
          );
        });

        const handleIncomingOperation = (message: any) => {
          console.log("[Op Handler] Received message:", message.body);
          try {
            const payload = JSON.parse(message.body);
            console.log("[Op Handler] Parsed payload:", payload);
            if (
              !payload ||
              !payload.clientId ||
              !payload.operation ||
              !payload.documentId ||
              !payload.sessionId
            ) {
              console.error(
                "[Op Handler] Invalid payload structure:",
                message.body
              );
              return;
            }

            const docId = payload.documentId;
            const opData = payload.operation;
            const sessionOfOp = payload.sessionId;
            const sourceClientId = payload.clientId;
            // Extract bundled selection/cursor data (might be null/undefined)
            const remoteSelectionData = payload.selection;
            const remoteCursorPosData = payload.cursorPosition;

            if (sessionOfOp !== sessionId) {
              console.log(
                `[Op Handler] Ignoring op for different session: ${sessionOfOp} (current: ${sessionId})`
              );
              return;
            }

            let operationForClient: TextOperation;
            try {
              console.log(
                `[Op Handler ${docId}] Attempting to parse operation from JSON:`,
                opData
              );
              operationForClient = TextOperation.fromJSON(opData);
              console.log(
                `[Op Handler ${docId}] Successfully parsed operation:`,
                operationForClient
              );
            } catch (e) {
              console.error(
                `[Op Handler ${docId}] Error parsing TextOperation.fromJSON:`,
                e,
                "Op Data:",
                opData
              );
              handleError(`Error parsing server op data for ${docId}: ${e}`);
              return; // Stop processing if op parsing fails
            }

            // Logic for Local vs Remote Ops
            if (sourceClientId === userId) {
              // This is an operation broadcast originating from this client
              // Usually handled by ACK, but good for webview sync
              if (webViewFileIds?.includes(docId)) {
                console.log(
                  `[Op Handler ${docId}] Applying own op to webview file.`
                );
                // If webview file, apply the operation directly via callback
                onOperationReceived(docId, operationForClient);
              }
            } else {
              // This is an operation from a remote client
              console.log(
                `[Op Handler ${docId}] Processing remote op from client: ${sourceClientId}`
              );
              // Handle remote selection/cursor *before* applying the operation locally
              if (docId === currentFileIdRef.current && editorInstance) {
                console.log(
                  `[Op Handler ${docId}] Handling remote selection/cursor for active editor.`
                );
                // Only process selection/cursor for the active editor file
                let incomingSelection: OTSelection | null = null;
                if (remoteSelectionData) {
                  try {
                    console.log(
                      `[Op Handler ${docId}] Attempting to parse selection from JSON:`,
                      remoteSelectionData
                    );
                    incomingSelection =
                      OTSelection.fromJSON(remoteSelectionData);
                    console.log(
                      `[Op Handler ${docId}] Successfully parsed selection:`,
                      incomingSelection
                    );
                  } catch (e) {
                    console.error(
                      `[Op Handler ${docId}] Error parsing OTSelection.fromJSON:`,
                      e,
                      "Selection Data:",
                      remoteSelectionData
                    );
                    // Don't stop processing the whole operation, just log the selection error
                  }
                }

                // Transform the *incoming* selection based on the *incoming* operation
                // This represents the selection *after* the operation is applied
                let transformedSelection: OTSelection | null = null;
                if (incomingSelection) {
                  try {
                    console.log(
                      `[Op Handler ${docId}] Transforming incoming selection against incoming op...`
                    );
                    transformedSelection =
                      incomingSelection.transform(operationForClient);
                    console.log(
                      `[Op Handler ${docId}] Transformed selection:`,
                      transformedSelection
                    );
                  } catch (e) {
                    console.error(
                      `[Op Handler ${docId}] Error transforming selection:`,
                      e,
                      "Selection:",
                      incomingSelection,
                      "Operation:",
                      operationForClient
                    );
                    // Don't stop processing, use untransformed selection as fallback? Or null?
                    // Let's stick with null if transform fails for now.
                    transformedSelection = null;
                  }
                } else {
                  transformedSelection = null;
                }

                // Get cursor position
                // If remoteCursorPosData exists, use it. Otherwise, try to derive from transformed selection.
                let finalCursorPosition: {
                  lineNumber: number;
                  column: number;
                } | null = remoteCursorPosData ?? null;
                console.log(
                  `[Op Handler ${docId}] Initial remote cursor pos:`,
                  finalCursorPosition
                );

                if (
                  !finalCursorPosition &&
                  transformedSelection &&
                  editorInstance
                ) {
                  console.log(
                    `[Op Handler ${docId}] Attempting to derive cursor from transformed selection head...`
                  );
                  const model = editorInstance.getModel();
                  if (model && transformedSelection.ranges.length > 0) {
                    try {
                      const headPos = offsetToPosition(
                        model,
                        transformedSelection.ranges[0].head
                      );
                      console.log(
                        `[Op Handler ${docId}] Derived head position:`,
                        headPos
                      );
                      // We need to adjust the derived position based on the operation
                      // Let's try transforming the original cursor if available, otherwise use the transformed selection head
                      if (remoteCursorPosData) {
                        // If original cursor was provided, use that as the primary source
                        console.log(
                          `[Op Handler ${docId}] Using original remote cursor data as final.`
                        );
                        finalCursorPosition = remoteCursorPosData;
                      } else {
                        // Fallback: use the head of the transformed selection
                        console.log(
                          `[Op Handler ${docId}] Using derived head position as final.`
                        );
                        finalCursorPosition = {
                          lineNumber: headPos.lineNumber,
                          column: headPos.column,
                        };
                      }
                    } catch (error) {
                      console.error(
                        `[Op Handler ${docId}] Error deriving cursor from transformed selection:`,
                        error,
                        "Selection:",
                        transformedSelection
                      );
                    }
                  }
                }

                // Fetch user info for the sender (name, color)
                // This might require accessing a shared state or passing it down
                // For now, we'll create a partial RemoteUser and let the App component fill the rest
                const updatedUserInfo: Partial<RemoteUser> = {
                  id: sourceClientId,
                  // Use transformed selection and final cursor position
                  selection: transformedSelection,
                  cursorPosition: finalCursorPosition,
                };

                // Update the remote user's state via callback
                console.log(
                  `[Op Handler ${docId}] Calling onRemoteUsersUpdate with derived user info:`,
                  updatedUserInfo
                );
                onRemoteUsersUpdate(docId, [updatedUserInfo as RemoteUser]); // Cast needed until full user info is fetched
              }

              // Apply the operation to the editor or background document state
              if (docId === currentFileIdRef.current) {
                if (clientRef.current) {
                  console.log(
                    `[Op Handler ${docId}] Calling client.applyServer for active file with op:`,
                    operationForClient
                  );
                  try {
                    clientRef.current.applyServer(operationForClient);
                    console.log(
                      `[Op Handler ${docId}] Successfully called client.applyServer.`
                    );
                  } catch (e) {
                    console.error(
                      `[Op Handler ${docId}] Error during client.applyServer:`,
                      e,
                      "Operation:",
                      operationForClient
                    );
                    handleError(
                      `Error applying server op locally for ${docId}: ${e}`
                    );
                  }
                } else {
                  console.warn(
                    `[Op Handler ${docId}] OT Client not ready for active file when receiving op.`
                  );
                  // Potential state inconsistency - may need to re-fetch state
                }
              } else if (webViewFileIds?.includes(docId)) {
                // Apply op to background webview files via callback
                console.log(
                  `[Op Handler ${docId}] Calling onOperationReceived for webview file with op:`,
                  operationForClient
                );
                onOperationReceived(docId, operationForClient);
              }
            }
            console.log(`[Op Handler ${docId}] Finished processing operation.`);
          } catch (error) {
            console.error(
              "[Op Handler] Error processing overall operations message:",
              error,
              "Message Body:",
              message.body
            );
            handleError(`Error processing operations message: ${error}`);
          }
        };

        // Subscribe to Active File Operations
        const activeOpTopic = `/topic/sessions/${sessionId}/operations/document/${currentFileId}`;
        newSubscriptions.push(
          stompClient.subscribe(activeOpTopic, handleIncomingOperation)
        );
        subscribedWebViewOpsRef.current.add(currentFileId);

        // Subscribe to WebView File Operations
        webViewFileIds?.forEach((webViewFileId) => {
          if (webViewFileId !== currentFileId) {
            const webViewOpTopic = `/topic/sessions/${sessionId}/operations/document/${webViewFileId}`;
            newSubscriptions.push(
              stompClient.subscribe(webViewOpTopic, handleIncomingOperation)
            );
            subscribedWebViewOpsRef.current.add(webViewFileId);
          }
        });

        // Selections Handling (Only for Active File) - Re-enable this handler
        const selectionTopic = `/topic/sessions/${sessionId}/selections/document/${currentFileId}`;
        newSubscriptions.push(
          stompClient.subscribe(selectionTopic, (message: any) => {
            console.log("[Selection Handler] Received message:", message.body);
            try {
              const payload = JSON.parse(message.body) as CursorMessage; // Use CursorMessage type
              console.log("[Selection Handler] Parsed payload:", payload);
              if (
                !payload ||
                !payload.userInfo ||
                !payload.userInfo.id ||
                !payload.documentId
              ) {
                console.error(
                  "[Selection Handler] Invalid payload structure:",
                  payload
                );
                return;
              }
              const { documentId, userInfo: remoteUserInfo } = payload;

              // Ignore messages from self
              if (remoteUserInfo.id === userId) {
                // console.log("[Selection Handler] Ignoring self message.");
                return;
              }
              // Ignore messages for other documents
              if (documentId !== currentFileIdRef.current) {
                console.log(
                  `[Selection Handler] Ignoring message for other document: ${documentId} (current: ${currentFileIdRef.current})`
                );
                return;
              }

              // Parse the incoming selection
              let incomingSelection: OTSelection | null = null;
              if (remoteUserInfo.selection) {
                try {
                  console.log(
                    "[Selection Handler] Attempting to parse selection from JSON:",
                    remoteUserInfo.selection
                  );
                  incomingSelection = OTSelection.fromJSON(
                    remoteUserInfo.selection
                  );
                  console.log(
                    "[Selection Handler] Successfully parsed selection:",
                    incomingSelection
                  );
                } catch (e) {
                  console.error(
                    "[Selection Handler] Error parsing OTSelection.fromJSON:",
                    e,
                    "Selection Data:",
                    remoteUserInfo.selection
                  );
                  // Don't stop processing, just log error
                }
              } else {
                console.log(
                  "[Selection Handler] No selection data in payload."
                );
              }

              // *** Crucial: Transform selection against local pending operations ***
              let transformedSelection: OTSelection | null = incomingSelection;
              if (clientRef.current && incomingSelection) {
                try {
                  console.log(
                    "[Selection Handler] Transforming selection against client state...",
                    incomingSelection
                  );
                  transformedSelection =
                    clientRef.current.transformSelection(incomingSelection);
                  console.log(
                    "[Selection Handler] Transformed selection:",
                    transformedSelection
                  );
                } catch (e) {
                  console.error(
                    "[Selection Handler] Error transforming selection:",
                    e,
                    "Selection:",
                    incomingSelection
                  );
                  transformedSelection = null; // Fallback to null if transform fails
                }
              } else if (!clientRef.current) {
                console.warn(
                  "[Selection Handler] Cannot transform selection, clientRef is null."
                );
              }

              // Use the explicitly sent cursor position if available, otherwise derive from transformed selection head
              let finalCursorPosition: {
                lineNumber: number;
                column: number;
              } | null = remoteUserInfo.cursorPosition ?? null; // Prefer explicitly sent cursor
              console.log(
                "[Selection Handler] Initial remote cursor pos:",
                finalCursorPosition
              );

              if (
                !finalCursorPosition &&
                transformedSelection &&
                editorInstance
              ) {
                console.log(
                  "[Selection Handler] Attempting to derive cursor from transformed selection head..."
                );
                const model = editorInstance.getModel();
                if (model && transformedSelection.ranges.length > 0) {
                  try {
                    const headPos = offsetToPosition(
                      model,
                      transformedSelection.ranges[0].head // Use head of *transformed* selection
                    );
                    console.log(
                      "[Selection Handler] Derived head position:",
                      headPos
                    );
                    finalCursorPosition = {
                      lineNumber: headPos.lineNumber,
                      column: headPos.column,
                    };
                  } catch (error) {
                    console.error(
                      "[Selection Handler] Error deriving cursor from transformed selection:",
                      error,
                      "Selection:",
                      transformedSelection
                    );
                  }
                }
              }

              const formattedUserForApp: RemoteUser = {
                id: remoteUserInfo.id,
                name:
                  remoteUserInfo.name ||
                  `User ${remoteUserInfo.id.substring(0, 4)}`,
                color: remoteUserInfo.color || "#CCCCCC",
                // Use transformed selection and final cursor position
                cursorPosition: finalCursorPosition,
                selection: transformedSelection,
              };
              // Pass the single updated user info to App.tsx for state update
              console.log(
                "[Selection Handler] Calling onRemoteUsersUpdate with formatted user info:",
                formattedUserForApp
              );
              onRemoteUsersUpdate(documentId, [formattedUserForApp]);
              console.log("[Selection Handler] Finished processing selection.");
            } catch (error) {
              console.error(
                "[Selection Handler] Error processing overall selections message:",
                error,
                "Message Body:",
                message.body
              );
              handleError(`Error processing selections message: ${error}`);
              // console.warn("[useCollaborationSession] Received message on deprecated selection topic. Ignoring.", message.body);
            }
          })
        );

        // ACK Handling
        const ackTopic = `/topic/ack/${userId}`;
        newSubscriptions.push(
          stompClient.subscribe(ackTopic, (message: any) => {
            if (message.body === "ack") {
              clientRef.current?.serverAck();
            } else {
            }
          })
        );

        // Store subscriptions
        subscriptionsRef.current = newSubscriptions;
      }, // End onConnect
      (error: any) => {
        handleError(
          `[STOMP Error] Connection Failed for ${sessionId}/${activeFileId}: ${error}`
        );
      }
    );

    // Cleanup function for the effect
    return () => {
      subscriptionsRef.current.forEach((sub) => {
        try {
          sub.unsubscribe();
        } catch (e) {}
      });
      subscriptionsRef.current = [];

      if (stompClientRef.current?.connected) {
        stompClientRef.current.disconnect(() => {
          handleConnectionStatusChange(false);
        }, {});
      }
      // Reset refs specific to this connection attempt
      clientRef.current = null;
      adapterRef.current?.detach();
      adapterRef.current = null;
      currentFileIdRef.current = null; // Clear tracked file ID
    };

    // Dependencies: Re-run when session/file changes, or editor becomes available/unavailable
  }, [
    isSessionActive,
    sessionId,
    activeFileId,
    editorInstance,
    userId,
    userInfo.name,
    userInfo.color,
    onStateReceived,
    onOperationReceived,
    onRemoteUsersUpdate,
    onChatMessageReceived,
    handleConnectionStatusChange,
    handleError,
    JSON.stringify(webViewFileIds),
  ]);

  // Effect to send initial presence when connection is established
  useEffect(() => {
    if (
      isConnected &&
      sessionId &&
      activeFileId &&
      userInfo.name.trim() &&
      stompClientRef.current?.connected
    ) {
      // Comment out the line below to prevent sending initial selection automatically
      // clientRef.current?.selectionChanged();
    }
  }, [
    isConnected,
    sessionId,
    activeFileId,
    userId,
    userInfo.name,
    userInfo.color,
  ]);

  // Add sendChatMessage function before the return statement
  const sendChatMessage = useCallback(
    (message: string) => {
      if (
        stompClientRef.current?.connected &&
        sessionId &&
        userInfo.name.trim() &&
        message.trim()
      ) {
        const chatPayload: ChatMessagePayload = {
          sessionId: sessionId,
          userId: userId,
          userName: userInfo.name,
          userColor: userInfo.color,
          message: message.trim(),
        };

        console.log("[Chat] Sending chat message:", chatPayload);
        stompClientRef.current.send(
          "/app/chat",
          {},
          JSON.stringify(chatPayload)
        );
        return true;
      }
      return false;
    },
    [sessionId, userId, userInfo.name, userInfo.color]
  );

  // Update the return value to include sendChatMessage
  return {
    isConnected,
    sendChatMessage,
  };
};
