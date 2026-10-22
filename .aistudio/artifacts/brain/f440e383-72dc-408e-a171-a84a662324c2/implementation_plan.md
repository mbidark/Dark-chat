# Implementation Plan — DARKCHAT Terminal Behavior Correction & Owner Authentication

Correct the DARKCHAT terminal UI and login flow to mirror a genuine command-line interface while enforcing secure server-backed password verification and complete removal of legacy invitation features.

## Proposed Changes

### 1. Genuine CLI Terminal Transcript & Input Architecture (`index.html`, `style.css`, `app.js`)
- **Inline Flow**: Position the active input prompt immediately inside the scrollable transcript `#terminalOutput`, directly following `#terminalLines`. The prompt moves down naturally as new output or chat messages are appended.
- **Visual Cursor & Caret Sync**: Keep the transparent native `<input id="termInput">` overlay with synchronized character rendering and a neon-green blinking block cursor (`█`).
- **Command History**: Implement Up/Down arrow key history navigation through previously submitted commands/messages in `app.js`.
- **Mobile Keyboard Visibility**: Ensure `visualViewport` event handlers and scroll triggers keep the active input visible on touch devices without fixed positioning.

### 2. Secure Owner Password Verification (`server.ts`, `firebase.js`, `app.js`)
- **Name Trigger**: Case-insensitive and trimmed check for name `"MBI DARK"`. Prompts `"Password:"` on the next line.
- **Zero Frontend Plaintext**: Exclude plaintext password from client code. Hash/verify via Express server route `/api/owner/login` (and crypto SHA-256 fallback).
- **Session Persistence**: Store authenticated Owner state in `sessionStorage` so the session remains active until the browser tab is closed.
- **Failure Flow**: Display `"Access denied."` on invalid credentials and reset back to the display name prompt.

### 3. Invitation System Purge (`owner.html`, `owner.js`, `firebase.js`, `app.js`)
- Remove all invitation link generators, token state handlers, invite modals, and invitation Firestore queries.
- Clean up `owner.html` UI to focus strictly on live visitor threads, broadcast messaging, and system controls.

---

## Verification Plan

### Automated Build Verification
1. Run `compile_applet` to confirm TypeScript and Vite compilation pass without errors.

### Manual Behavior Verification
1. **Terminal Input Flow**:
   - Type a visitor name. Verify line appears in transcript and prompt moves down to the next line.
   - Send chat messages. Verify lines append chronologically and the active prompt stays at the bottom.
   - Test Up/Down arrow keys to cycle through previous input history.
2. **Owner Authentication ("MBI DARK")**:
   - Type `"MBI DARK"`. Verify prompt changes to `"Password:"`.
   - Enter wrong password (`wrongpass`). Verify `"Access denied."` appears and user is returned to name prompt.
   - Enter correct password (`Dark_Host.02`). Verify access granted and redirected to Owner panel.
3. **Session Persistence**:
   - Verify Owner session persists on reload within the same tab (`sessionStorage`).
   - Closing the tab clears the session.
4. **Invitation Purge Verification**:
   - Inspect Owner panel and app bundle to ensure zero invitation elements or endpoints exist.
