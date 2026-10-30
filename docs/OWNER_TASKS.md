# Your tasks, step by step

Where you are (29 October 2026): Prompts 0.1 to 2.1 are done and tested. That covers the foundation, the accounting core and the API. **Nothing is saved in Git yet.**

How to read this list:

- 📱 = you can do it on your phone.
- 💻 = you need your computer.
- 🤖 = tell Claude to do it.

---

## Part A: right now (at your computer, about 1 hour)

### 1. Save the work in Git 🤖

Tell Claude: **"Commit everything and push"**.

Claude checks that no secret is included (`.env` stays out) and pushes to GitHub (`usama-hrb/GHAIT---`). GitHub then runs the tests automatically.

✅ Done when: GitHub shows the code and the "CI" check is green.

### 2. Add the new secret to your `.env` 💻

The API now needs a secret key for logins.

1. In a terminal, in the project folder, run:
   `openssl rand -base64 48`
2. Open `.env` and add this line, with the result of step 1:
   `JWT_ACCESS_SECRET=<the result>`
3. Also copy these two lines from `.env.example`:
   `MIGRATE_ON_START=true`
   `LOG_LEVEL=info`

### 3. Start the app 💻

`make up`

✅ Done when: the command finishes without error, and `make ps` shows every service "healthy".

### 4. Create your owner account 💻

`make owner USERNAME=<your username> NAME="<your name>"`

Type a password of 12 characters or more. The screen shows nothing while you type; that is normal.

✅ Done when: it prints "Owner created."

Forgot it later? Run the same command with the same username to set a new password.

### 5. Check the API 💻

Open http://localhost:4000/docs in the browser.

✅ Done when: you see the API documentation page (login, settings, audit). This is the Phase 2 check.

### 6. Check the core with a calculator 📱

This is the Phase 1 check. Do the math yourself:

- **T6, a month:** sales 2000 dh, cost 1600 dh → profit 400. Minus expenses 100 → 300. Split in three → **100 each** (you, partner, shop).
- **T8, a debt:** invoice 200 dh that cost 160 dh.
  - First payment 100 → all of it is capital back, profit 0.
  - Second payment 100 → 60 more capital back, **profit 40**.

✅ Done when: you agree with these numbers. If not, tell Claude.

---

## Part B: decisions to review (on your phone, any time)

### 7. Read the decisions Claude made 📱

Open `docs/accounting-assumptions.md` on GitHub. Look hardest at the ones that touch money between you and your partner:

- **S1:** profit split 1/3 each, stored as 1/1/1.
- **S2:** an odd cent of the shop's share goes to you.
- **S5:** a bad debt loses only the capital not yet paid back.
- **I2:** a difference in the cash count counts as that month's loss or gain.
- **I3:** fabric a partner takes is a draw at cost price.

To change one, tell Claude: "Change S2 to …".

### 8. Agree with your partner, in writing 📱

The spec asks for this before launch (§17.2, §17.8). It happens outside the app, but it is required. Agree on:

- the profit split (1/3 each?);
- what happens in a losing month (the loss carries to the next month);
- damaged fabric and bad debts (they lower the profit before the split);
- what happens if one of you leaves (capital, exit rules).

Write it down and both sign.

### 9. Ask a trusted scholar about zakat 📱

Spec §17.1. Ask about:

- the nisab: gold (85 g) or silver (595 g)?
- stock valued at selling price or at cost?
- do doubtful debts count?
- is the shop a "مدير" (sells every day)? Claude assumed yes.

Send the answers to Claude before step 23.

### 10. Decide the invoice text 📱

This is needed by step 14. Decide the shop name and phone number that appear on WhatsApp invoices (the brand is غيث).

---

## Part C: build the MVP (the app the shop uses every day)

**For each step below:**

1. Tell Claude **"Continue"**.
2. When Claude is done, do the ✅ check yourself.
3. Tell Claude **"Review this slice against the spec"**.
4. Tell Claude **"Commit and push"**.
5. Start a new Claude session for the next step.

### 11. Prompt 3.1: fabrics catalog, working without internet 🤖💻

✅ Do this:

1. Open the app on the computer and on the phone.
2. Turn the internet off on one of them.
3. Add a fabric there.
4. Turn the internet back on.

The fabric must appear on the other device.

### 12. Prompt 3.2: buying fabric → rolls 🤖💻

✅ Do this:

- Buy a Rosa assortment of 10 colors × 50 m at 16 dh/m → **10 rolls of 800 dh** each (T1).
- Buy one piece of 2.3 m for 100 dh → cost **43.48 dh/m** (T2).

### 13. Prompt 3.3: stock screen and corrections 🤖💻

✅ Do this:

- Buy 20 kg for 400 dh (estimated 80 m), then enter the real length, 76 m. The cost per metre becomes **5.26 dh** (T4).
- Record 30 cm of damaged fabric on a roll of 50 m that cost 800 dh → a loss of **4.80 dh** (T12).

### 14. Prompt 3.4: the till (sales) 🤖💻

✅ Do this:

- Sell a length that needs two rolls.
- Lower the price during the sale.
- Share the invoice on WhatsApp.
- Turn the internet off in the middle of a sale and finish it anyway.

### 15. Prompt 3.5: customers, debts, payments 🤖💻

✅ Do this: a credit sale of 200 dh, then payments of 100 and 100 (T8). The "who owes me" list must be right.

### 16. Prompt 3.6: sync hardening and server setup 🤖💻

✅ Done when: Claude's acceptance checklist (`docs/MVP_ACCEPTANCE.md`) passes.

### 17. Put the app on a server 💻

1. Rent a small VPS (a server on the internet).
2. Buy a domain name.
3. Follow `docs/runbooks/deploy.md` (Claude writes it in step 16) and `docs/runbooks/api.md`.
4. Set real passwords and secrets in the server's `.env`.
5. Run `make up STACK=prod`.
6. Run `make owner STACK=prod USERNAME=<you>`.
7. Run `make backup-verify STACK=prod`. It must succeed.

✅ Done when: the app opens on your phone with your domain (https).

### 18. One real day in the shop 📱💻

Run the shop a full day on the app, **and** on your paper notebook at the same time.

✅ Done when: the stock and the debts match the notebook. Only then go on.

---

## Part D: money and partnership (Phase 4)

Same routine as Part C: "Continue", check, review, commit.

### 19. Prompt 4.1: expenses 🤖

✅ The rent reminder works. An expense counts in the month it was paid.

### 20. Prompt 4.2: partners, capital, withdrawals 🤖

✅ Enter the real money each of you put in.

### 21. Prompt 4.3: monthly settlement 🤖

✅ Check these:

- T6: 300 dh → 100 / 100 / 100.
- T9: a losing month carries its loss to the next.
- T10: the shop's third is added to capital, half each.
- A settled month is locked.

### 22. Prompt 4.4: integrity check, cash count, history 🤖

✅ Do a real cash count. The integrity screen must say OK, and the history must show every change.

---

## Part E: growth (Phase 5)

### 23. Prompt 5.1: zakat 🤖

Send Claude the scholar's answers from step 9 first.

✅ T14: base 36,000 dh → zakat 900 dh.

### 24. Prompt 5.2: reports 🤖

Profit by month and by fabric, best sellers, slow stock, who owes what.

### 25. Prompt 5.3: returns, supplier debts, accounts for your partner and a worker 🤖

---

## After launch: habits

- **Every day 📱:** the app shows no pending changes (everything synced).
- **Every month 💻:**
  - Do the settlement and the cash count; the integrity check must be OK.
  - Run `make backup-verify STACK=prod` (backups run every night by themselves).
- **Every year 📱:** the zakat report, two weeks before the hawl date.
- **Before each update 🤖:** tell Claude "Run the before-release checklist".

## Useful things to tell Claude

- "Continue": the next prompt.
- "Review this slice against the spec": a quality check.
- "We found an accounting bug: … (with the numbers)": Claude first writes a test that shows the bug, then fixes it.
- "Commit and push": save to GitHub.
- "Change decision S2 to …": change a rule from step 7.
