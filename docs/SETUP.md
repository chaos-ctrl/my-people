# Setting up My people

This guide takes you from nothing to a working app on your phone, one click at a time. It takes about
30 minutes. You only do it once.

**What you'll end up with**

- **The app** at `https://chaos-ctrl.github.io/my-people/`. It's public but contains no data: it's just the program.
- **Your data** in a private repository, `chaos-ctrl/my-people-data`: one small text file per person, plus settings.
  Only you (and whoever you give a token to) can see it.
- **A weekly reminder** on your phone through the free **ntfy** app, sent by GitHub even when the app is closed.
- **Birthdays from Google Calendar**, copied into your people once a day (read-only; nothing is ever written to Google).

> **Before you start:** the app's code must be on the `main` branch of `chaos-ctrl/my-people`. If it is
> still in a pull request, open the pull request on GitHub and click **Merge pull request**, then **Confirm merge**.

---

## 1. Put the app online

### 1a. Turn on GitHub Pages

1. Go to <https://github.com/chaos-ctrl/my-people>.
2. Click **Settings** (the gear tab at the top of the repository, not your account settings).
3. In the left sidebar, under **Code and automation**, click **Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Under **Branch**, choose **main** and **/ (root)**, then click **Save**.
6. Wait one or two minutes, then refresh the page. A box at the top says
   **Your site is live at https://chaos-ctrl.github.io/my-people/**.

### 1b. Create the "stable" bookmark

The reminder and calendar robots don't use the newest code automatically. They use a bookmarked
version, a branch called `stable`, so a mistake in new code can't touch your secrets until you choose to update.

1. Go to <https://github.com/chaos-ctrl/my-people>.
2. Above the list of files, click the button that says **main** (with a branch icon).
3. In the box that opens, type `stable`.
4. Click **Create branch stable from main**.

*Updating later* is described in [Updating the app](#updating-the-app).

---

## 2. Create your private data repository

1. Click the **+** at the top right of any GitHub page, then **New repository**.
2. **Owner**: `chaos-ctrl`. **Repository name**: `my-people-data`.
3. Choose **Private**. This matters: your notes about people go here.
4. Tick **Add a README file** (so the repository isn't empty).
5. Click **Create repository**.

Now copy five files into it from the `data-repo-template` folder of `my-people`. For each file in the table:

| In `my-people`, open… | In `my-people-data`, create a file named… |
|---|---|
| `data-repo-template/settings.yml` | `settings.yml` |
| `data-repo-template/calendar-review.yml` | `calendar-review.yml` |
| `data-repo-template/AGENTS.md` | `AGENTS.md` |
| `data-repo-template/.github/workflows/reminders.yml` | `.github/workflows/reminders.yml` |
| `data-repo-template/.github/workflows/calendar-sync.yml` | `.github/workflows/calendar-sync.yml` |

For each one:

1. In a browser tab, open the file in `my-people`. For example go to
   <https://github.com/chaos-ctrl/my-people/tree/main/data-repo-template> and click `settings.yml`.
   For the two workflow files, click `.github`, then `workflows`.
2. Above the file's content, on the right, click the **Copy raw file** button (two overlapping squares).
3. In another tab, go to <https://github.com/chaos-ctrl/my-people-data>.
4. Click **Add file** → **Create new file**.
5. In the name box, type the name from the right-hand column, exactly. Typing `/` creates a folder, so
   `.github/workflows/reminders.yml` becomes the file `reminders.yml` inside `.github/workflows`.
6. Click in the big text area and paste (Ctrl+V).
7. Click **Commit changes…**, then **Commit changes** again.

When you're done, `my-people-data` contains `README.md`, `settings.yml`, `calendar-review.yml`, `AGENTS.md`
and a `.github` folder. The `people` folder appears by itself when you add your first person.

---

## 3. Create the access token

The app talks to GitHub with a *fine-grained personal access token*: a password that only works on
`my-people-data` and only for what the app needs.

1. Click your profile picture (top right of GitHub) → **Settings**.
2. At the very bottom of the left sidebar, click **Developer settings**.
3. Click **Personal access tokens** → **Fine-grained tokens**.
4. Click **Generate new token**. GitHub may ask for your password or a code.
5. **Token name**: `My people`. **Description**: `Phone app` (anything helps you recognise it).
6. **Resource owner**: `chaos-ctrl`.
7. **Expiration**: choose **90 days** (recommended). Note the date shown; the app asks for it.
8. **Repository access**: choose **Only select repositories**, then pick **chaos-ctrl/my-people-data**.
   Don't choose "All repositories".
9. Under **Permissions** → **Repository permissions** (click **Add permissions** if you only see a button):
   - **Contents**: **Read and write**.
   - **Actions**: **Read and write**. This is only for the app's "Send a test notification" button;
     skip it if you don't want that button.
   - **Metadata** is added automatically as read-only. Leave everything else at **No access**.
10. Click **Generate token** (and confirm).
11. The token starts with `github_pat_`. Click the copy icon next to it. **GitHub shows it only once.**
    Keep this tab open until you've pasted it into the app.

Do this once per device if you like (a token for the phone, another for the computer). That way you can
revoke one without affecting the other.

---

## 4. Open the app and connect it

1. On your phone, open **Chrome** and go to <https://chaos-ctrl.github.io/my-people/>.
2. **Data repository** is already filled in: `chaos-ctrl/my-people-data`.
3. Paste the token into **Access token**.
4. Type the **Token expiry date** from step 3 (day first: `24/12/2026`).
5. Tap **Connect**.
6. Choose how this phone remembers the token:
   - **Fingerprint or face unlock** (recommended where offered): the token is encrypted and unlocked
     with your phone's own fingerprint, face or screen lock. Nothing biometric leaves the phone.
   - **PIN**: you type a PIN each time.
   - **Remember without a PIN**: only for a device nobody else uses.
   - **Don't remember**: paste the token every time.
7. For the first two, choose a PIN of at least 6 digits. It's the backup if the fingerprint unlock ever fails.
   If you forget it, choose **Forget this device** on the lock screen and connect again with a token.
8. Tap **Continue**. Your phone may ask for your fingerprint. The app opens, empty for now.

Add your first person with **Add person**. The app asks when you were last in touch; a rough guess like
"About 2 years ago" is fine.

---

## 5. Set up notifications (ntfy)

ntfy is a free, open-source notification app. The reminder robot sends a message to a "topic", and
your phone listens to that topic.

**Choose a secret topic name.** On the public ntfy.sh server, *anyone who knows the topic name can read
the messages*, so the name must be long and random, like a password.

1. In the app, tap **Settings** → **Notification topic** → **Generate**, then **Copy**.
2. Paste it somewhere safe for a minute (you need it twice: in the ntfy app, and in step 6).

**Install ntfy on Android.**

1. Install **ntfy** from the Google Play Store (or F-Droid).
2. Open it and tap the **+** button.
3. **Topic name**: paste the topic. Leave **Use another server** off.
4. Tap **Subscribe**.

---

## 6. Add the secrets to the data repository

Secrets are values the robots can use but nobody can read back, not even you.

1. Go to <https://github.com/chaos-ctrl/my-people-data>.
2. Click **Settings** → in the left sidebar **Secrets and variables** → **Actions**.
3. Click **New repository secret**. **Name**: `NTFY_TOPIC`. **Secret**: paste your topic. Click **Add secret**.
4. *(Optional)* To also get the reminder by email, add `NTFY_EMAIL` with your email address, and tick
   **Email (via ntfy)** in the app's Settings → Reminders.
5. You'll add `CALENDAR_ICS_URL` in the next step.

Advanced, optional: `NTFY_SERVER` if you run your own ntfy server (default `https://ntfy.sh`),
and `NTFY_TOKEN` if that server requires an access token.

---

## 7. Connect Google Calendar

The calendar robot reads your main Google Calendar through its **secret iCal address** once a day and
copies birthdays and wedding anniversaries into your people. It only reads yearly, all-day events.

**Get the address** (on a computer; the phone app doesn't show it):

1. Go to <https://calendar.google.com>.
2. Click the gear (top right) → **Settings**.
3. In the left sidebar, under **Settings for my calendars**, click your calendar (usually your name).
4. Scroll down to **Integrate calendar**.
5. Next to **Secret address in iCal format**, click the copy icon. It ends in `basic.ics`.
6. Add it as a secret in `my-people-data` like in step 6: **Name** `CALENDAR_ICS_URL`, **Secret**: paste.

This address gives read access to your whole calendar, so treat it like a password: only paste it into the secret.

**If it ever leaks:** go back to the same place in Google Calendar settings, click **Reset** next to the secret
address, confirm, then copy the new address and update the `CALENDAR_ICS_URL` secret (open the secret and click
**Update**). The old address stops working immediately.

Good to know: Google's automatic "Birthdays" calendar (from Google Contacts) is a separate calendar and isn't
included. Birthdays you created yourself as yearly events ("Marc 🎂", "Anniversaire Julie") are.

**Trips.** The robot also spots upcoming one-off events (flights, hotel stays, weekends away) whose place or title
names a city where one of your people lives (their **City** field), and shows "Lyon: Nina lives there" under
**Coming up**. Only the city and dates are saved, in `trips.yml`. In the app, open **Settings** → **Calendar sync**
and type your own **home city** so events there aren't taken for trips; untick **Spot trips** to turn it off.

---

## 8. Add the app to your home screen

1. In Chrome on your phone, open <https://chaos-ctrl.github.io/my-people/>.
2. Tap the **⋮** menu (top right) → **Add to home screen** (or **Install app**).
3. Tap **Install**. The app now opens like any other, full screen.

---

## 9. Try it

**Test notification**

1. In the app, tap **Settings** → **Send a test notification**.
2. Within a minute or two, ntfy shows "My people (test)". Tapping it opens the app.

If nothing arrives: in `my-people-data`, open the **Actions** tab, click the latest **Reminders** run, and read
the red message. It usually names the missing secret.

**First calendar sync**

1. In `my-people-data`, click the **Actions** tab.
2. In the left list, click **Calendar sync**.
3. Click **Run workflow** (on the right) → **Run workflow**.
4. After about 30 seconds, refresh. A green tick means it worked. Open the run to see the summary, e.g.
   `Calendar sync: 3 updated, 2 to review` (plus `, 1 trip` when trips changed).
5. Reopen the app. Birthdays appear under **Coming up**, and anything unclear appears under **Check these**,
   where you can attach it to someone, create a new person, or dismiss it.

**When do reminders arrive?** By default on Sundays around 09:00 (Paris time). Change the days, time and
content in the app under **Settings** → **Reminders**; nothing to edit on GitHub. The robot checks every hour
and only sends at the chosen hour, so it arrives a few minutes past the hour (GitHub can occasionally delay a
scheduled run).

**GitHub Actions minutes.** Private repositories get 2,000 free minutes a month. The hourly check uses about
750, so you're well within the limit.

---

## Renewing the token

The app warns you 14 days before the token expires.

1. Create a new token exactly as in [step 3](#3-create-the-access-token).
2. In the app: **Settings** → **Forget this device**, then connect again with the new token (step 4).
3. On GitHub, in **Fine-grained tokens**, click the old token → **Delete**.

If you lose your phone: delete its token on GitHub straight away. Nothing else is needed. The phone doesn't hold
your people's data, only the (encrypted) token.

## Updating the app

The app itself (what you see in the browser) updates as soon as new code is merged into `main`.
The robots keep using the `stable` bookmark until you move it:

1. Go to <https://github.com/chaos-ctrl/my-people/compare/stable...main>.
2. Click **Create pull request**, then **Create pull request** again.
3. Click **Merge pull request** → **Confirm merge**.

## Privacy, in short

- The public repository `my-people` never contains personal data. Your people live only in the private
  `my-people-data`.
- The app keeps your people in memory only, never stored in the browser. Locking (after 10 idle minutes by
  default) clears them and the token.
- Notifications on the public ntfy.sh server can be read by anyone who guesses the topic, hence the long random
  topic and the "names only" default. Running your own ntfy server removes this; then set `NTFY_SERVER` (and
  `NTFY_TOKEN` if needed).
- AI assistants with access to `my-people-data` can update people for you; `AGENTS.md` there tells them how.
  When `data-repo-template/AGENTS.md` changes in `my-people` (new features), copy it again into
  `my-people-data` the same way as in step 2 so assistants know the new rules. Settings need nothing:
  missing keys in `settings.yml` use their defaults.

## Troubleshooting

| You see | What to do |
|---|---|
| "GitHub refused the token" | The token expired or was deleted: see [Renewing the token](#renewing-the-token). |
| "Not found. Check the repository name…" | The token wasn't given access to `my-people-data` (step 3, point 8), or the name is misspelt. |
| "…can read the repository but not save to it" | Give the token **Contents: Read and write**. You can edit an existing token's permissions on GitHub. |
| "The token needs the Actions: Read and write permission" | Only needed for the test button; add it to the token, or run **Reminders** from the Actions tab with **test** ticked. |
| "This file needs fixing" in the list | Someone (or an AI) broke that person's file. Tap it → **Open the file on GitHub** and fix the part between the `---` lines. |
| A reminder run fails with "settings.yml can't be read" | The settings file has a typo. Open it on GitHub; the error names the line. |
