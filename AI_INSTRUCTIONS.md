# AI Browser Testing Instructions

When using the `browser_subagent` to view the DOM or test UI interactions:
1. **DO NOT** use `file:///` URLs (e.g. `file:///C:/Users/.../index.html`). The subagent security sandbox blocks `file:///` access.
2. **DO NOT** try to connect to the backend server port (e.g. `http://localhost:8000`) for the UI, as `server.py` in this project only serves `/api/` endpoints, not the static `index.html`.
3. **DO THIS INSTEAD**: Start a temporary static file server in the background using the `run_command` tool.
   * Command: `python -m http.server 8080` (or `npx http-server -p 8080`)
   * Send the command to the background (`WaitMsBeforeAsync` set to ~1000).
4. After the server starts, instruct the `browser_subagent` to navigate to `http://localhost:8080/index.html`.
5. Once testing is complete, you can optionally terminate the background static server using the `send_command_input` tool.
