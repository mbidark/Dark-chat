# DARKCHAT — MBI DARK | Zero-to-Production

> A secure, mobile-first, real-time hacker terminal messaging website with same-name grouped inbox, unique public visitor IDs, cryptographic invitations, and Owner controls.

---

## ✿ Technology Stack & Architecture

- **Core**: Vanilla JavaScript (ES Modules), HTML5, CSS3, Vite build pipeline.
- **Backend / Real-time**: Firebase Authentication (Anonymous & Email/Password), Cloud Firestore (ABAC Security Rules), Local Multi-Tab Real-time Mesh.
- **Design Constitution**:
  - Pure Black `#000000` background.
  - Neon-Green `#00ff66` terminal typography with subtle CRT scanline atmosphere.
  - Left-aligned line-by-line terminal output.
  - Zero cards, zero chat bubbles, zero rounded borders.
  - **Terminal Input Priority**: All active input is permanently pinned at the **TOP** of the terminal area with synchronized blinking block cursor `█`.
  - Native Android/iOS keyboard friendly (viewport safe-area, auto-resizing, natural capitalization, no detached cursor).

---

## ✿ Project File Structure (Flat Root)

```text
/
├── index.html            # Visitor terminal interface (top-input layout)
├── owner.html            # Owner dashboard with grouped inbox & brand toggle
├── style.css             # Terminal styling, Hack font, scanlines, glow & layout
├── app.js                # Visitor terminal client & boot animation
├── owner.js              # Owner dashboard client, recipient routing & controls
├── firebase.js           # Firebase Auth, Firestore streams & resilient multi-tab sync
├── invite.js             # Cryptographic token generation, validation & redemption
├── utils.js              # Domain logic: name normalization, public IDs, timestamps
├── test.js               # Pure logic unit test suite (run via node --test test.js)
├── firestore.rules       # Hardened ABAC security rules (zero-trust thread isolation)
├── storage.rules         # Storage deny-all rules
├── firebase.json         # Firebase hosting and rule configuration
├── firebase-blueprint.json # Schema specification intermediate representation
├── vite.config.ts        # Vite MPA build configuration (relative base for GitHub Pages)
├── package.json          # Project metadata and dependencies
└── README.md             # Complete deployment and setup manual
```

---

## ✿ Features & Acceptance Matrix

| Feature | Implementation | Verified Status |
| :--- | :--- | :--- |
| **Top Terminal Input** | Pinned at top; genuine native textarea overlaid with real-time text & block cursor `█` | ✅ Tested & Verified |
| **Blinking Block Cursor** | Inverted char cursor in text, block `█` at end, persistent on blur | ✅ Tested & Verified |
| **Initial Boot Animation** | `python initializing...` -> `what's your name?` -> name prompt directly underneath | ✅ Tested & Verified |
| **Name Normalization** | Trims and collapses whitespace case-insensitively while preserving original case | ✅ 10/10 Unit Tests Passed |
| **Unique Public IDs** | Authoritative 6-char alphanumeric code (e.g., `A7K2M9`, `Q4P8X2`) | ✅ Collision-tested |
| **Same-Name Shared Inbox** | Visitors with identical names (e.g., "Sabbir", "sabbir") share one inbox entry with `[N users]` badge | ✅ Tested & Verified |
| **Combined Transcript** | Chronological transcript with unique `[ID]` for every message | ✅ Tested & Verified |
| **Unread Green Dot** | Glowing neon-green dot `●` indicates unread messages per group | ✅ Tested & Verified |
| **Recipient Message Routing** | Owner selects `ALL USERS` (group broadcast) or individual visitor `[ID]` | ✅ Tested & Verified |
| **Typing Indicator** | Restrained animated block effect: `OWNER TYPING ▰ ▰ ▰` | ✅ Tested & Verified |
| **Cryptographic Invitations** | Secure tokens, URL builder, single-use validation, bypasses name prompt | ✅ Tested & Verified |
| **Brand Panel Toggle** | Clicking `✿ "Mʙɪ Dᴀʀᴋ"` collapses or expands inbox sidebar | ✅ Tested & Verified |
| **Security Rules** | Visitors can only read/write their own private thread; Owner access verified | ✅ Production-ready |

---

## ✿ Setup & Deployment Guide

### 1. Create a New Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project** and name it (e.g. `darkchat-production`).
3. Click **Add App** -> Select **Web (`</>`)**.
4. Note the generated `firebaseConfig` object.

### 2. Enable Authentication Providers
1. In Firebase Console, navigate to **Build** -> **Authentication** -> **Sign-in method**.
2. Enable **Anonymous** authentication (for visitors).
3. Enable **Email/Password** authentication (for Owner).
4. In the **Users** tab, click **Add user** and create the Owner account (e.g., `admin@darkchat.local` with a strong password).
5. Copy the generated Owner **UID**.

### 3. Provision Cloud Firestore
1. Navigate to **Build** -> **Firestore Database** -> **Create database**.
2. Select **Production Mode** and choose your cloud region.
3. In the Firestore collection browser, create an `admins` collection:
   - Collection ID: `admins`
   - Document ID: `<PASTE_YOUR_OWNER_UID_HERE>`
   - Document fields: `{ "role": "owner", "email": "your_email@domain.com" }`

### 4. Deploy Security Rules
In your local project directory:
```bash
# Login to Firebase CLI
npx firebase login

# Deploy rules
npx firebase deploy --only firestore:rules,storage
```

### 5. Configure Custom Credentials in Browser
When accessing `owner.html` or `index.html`, credentials can either be passed via `localStorage.setItem('darkchat_firebase_config', JSON.stringify(config))` or by setting `VITE_FIREBASE_*` environment variables during build.

---

## ✿ GitHub Pages Deployment

### Target URLs:
- **Public Visitor URL**: `https://mbidark.github.io/darkchat/`
- **Owner Dashboard URL**: `https://mbidark.github.io/darkchat/owner.html`

### Steps to Deploy to GitHub Pages:
1. Initialize Git and commit all root-level files:
   ```bash
   git init
   git add .
   git commit -m "feat: complete DARKCHAT zero-to-production implementation"
   git remote add origin https://github.com/mbidark/darkchat.git
   git branch -M main
   ```
2. Build the production bundle:
   ```bash
   npm run build
   ```
   *Note: `vite.config.ts` uses relative paths (`base: './'`), guaranteeing zero broken asset paths on any subpath or custom domain!*
3. Deploy to `gh-pages` branch:
   ```bash
   # Using git subtree or gh-pages package
   npx gh-pages -d dist
   ```
4. In GitHub repository settings -> **Pages** -> Source: `Deploy from a branch` -> Branch: `gh-pages` / `/root`.

---

## ✿ Running Tests & Local Verification

Run pure unit logic tests directly with Node's native test runner:
```bash
node --test test.js
```

Build verification:
```bash
npm run build
```
