# SiteLedger

An owner-operated construction management workspace for Sri Lanka, in English and LKR. Responsive laptop and phone interface, backed by a persistent SQLite database.

## Run

Requires Node.js 24 or newer. No third-party runtime packages or installation are required.

```sh
cd /workspace/constructionManager
npm start
```

The default address is `http://127.0.0.1:3000`. On first use, create the owner password (minimum 10 characters). No demo credentials or records are installed. Passwords are salted and hashed; sessions last 12 hours and are reset when the server restarts.

Optional configuration: `PORT`, `HOST`, `DATA_DIR` (defaults to `data`), `COOKIE_SECURE=1` when deployed behind HTTPS. For public deployment use a trusted HTTPS reverse proxy, set secure cookies, and protect the initial owner-account setup before exposing the app. This repository does not deploy a public service.

## Workflow

1. Create projects with client, location, budget, dates and status.
2. Enter daily diaries for work completed, weather, progress and problems. Attach photos separately under Documents.
3. Add material units and minimum stock thresholds. Record opening stock, receipts, usage, wastage and transfers. Cost is the **total batch value**, not the per-unit rate. Consumption and transfers cannot exceed current stock.
4. Add workers with a daily rate or monthly base salary and individual overtime hourly rate. Record attendance at each site. Split a day between sites using fractions, such as 0.5 + 0.5. Combined attendance cannot exceed one day or 24 overtime hours per employee/date. Rates are captured when attendance is saved, preserving historical entries if employee rates change.
5. Select a payroll period. Daily pay is days × recorded daily rate + overtime. Monthly payroll adds one full current base salary, so select one calendar month for those workers. Advances and salary payments within that period reduce the balance. Prior-period unpaid balances and advance carry-forward are not automated.
6. Record hire units, rate and amounts paid. Use Edit / pay to update paid amounts. Record general expenses, client payments, salary advances and salary payments in Accounts. Do not duplicate material or hire costs as expenses.
7. Upload PDFs, JPG/PNG/WebP photos or text documents up to 5 MB. Download documents and export registers as CSV for Excel.

## Current boundaries

This is a first working version, not statutory accounting software. Site costs include material opening/receipt values, daily wages, overtime, hire accruals and general expenses. Monthly base salary allocation, cost redistribution on stock transfers, supplier credit ledgers, tax reports, automated weekly payroll posting, carry-forward payroll balances and Excel imports are not implemented. No profit figure is presented because these cost allocations are incomplete.

Projects, diaries, employees, hires and transactions can be edited. Attendance and stock movements are append-only in this version; correction/reversal workflows are a follow-up requirement. Stock checks use entry order, not historical balances for backdated movements. Owner-only access; no roles or employee accounts.

## Validation

```sh
npm run check
npm test
```

Integration tests exercise owner authentication, project creation, cross-site attendance limits, payroll amounts, transfers, insufficient stock rejection, hire payments, document storage and persistence through a server restart. They use temporary databases and do not modify live records.

## Backups

The database is in `data/siteledger.sqlite`, with SQLite WAL companion files. Stop the server before copying the complete data directory to a secure backup, or use SQLite's online backup tooling. Do not commit the database or uploaded documents. Backups must be stored outside the ephemeral cloud machine for durability; automatic external backups are not configured.
