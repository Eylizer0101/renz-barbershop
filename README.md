<div align="center">

# RENZ Barbershop

### Barbershop Queue, Appointment and Management System

A web-based solution for organizing customer visits, managing barbershop operations, recording payments, and reviewing business performance.

![Node.js](https://img.shields.io/badge/Backend-Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Framework-Express.js-303030?style=flat-square&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/Database-MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)
![JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Deployment](https://img.shields.io/badge/Deployment-Render-454EAA?style=flat-square&logo=render&logoColor=white)

[Overview](#overview) · [Features](#key-features) · [Technology](#technology-stack) · [Setup](#getting-started) · [Security](#security-and-privacy)

</div>

---

## Overview

**RENZ Barbershop Management System** is a browser-based application built to simplify daily operations in a barbershop. It brings customer queue and booking activities, front-desk services, payment records, and administrative tools into one system.

The project supports three primary user roles: **Customer**, **Cashier**, and **Administrator**. It also provides a queue display intended for use inside the shop. Its goal is to improve visibility of service status and reduce repetitive manual recordkeeping.

## Key Features

### Customer

- Join or monitor a service queue, including support for walk-in customers.
- View queue status and estimated waiting information where available.
- Browse available barbers and haircut services.
- Access booking, appointment, and visit-related screens.
- Review past visits and provide service feedback when supported by the active flow.
- Manage account information if using a registered customer account.

### Cashier

- Add walk-in customers and organize the daily queue.
- Call the next customer, monitor active services, and update visit status.
- Handle customer check-ins and appointment-related desk operations.
- Record completed services and payment transactions.
- Review daily front-desk activity and customer information based on access permissions.
- Record product sales when inventory and sales functions are configured.

### Administrator

- Review operational dashboards and business analytics.
- Manage barber profiles, services, and prices.
- Maintain product inventory and staff records.
- Review payments and generate reports.
- Monitor customer records, reviews, and activity logs.
- Manage administrative access and other permitted operations.

### Queue and Operational Workflow

1. A customer registers a service request or a cashier adds a walk-in customer.
2. Staff organize waiting customers based on barber availability and applicable queue rules.
3. The cashier calls the customer when service begins.
4. After the service, the cashier records completion and payment.
5. Authorized staff can review the transaction in operational records and reports.

> **Implementation note:** The repository contains both older queue-system documentation and a newer frontend-structure document that explicitly identifies some named frontend modules as placeholders. Review the currently deployed screens and routes before assuming every booking or reporting feature listed above is fully active.

## Technology Stack

| Layer | Technologies |
| --- | --- |
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js 20+, Express.js 5 |
| Database | MongoDB; official MongoDB Node.js driver |
| Authentication and security | bcryptjs, JSON Web Tokens, cookie-parser, Helmet, express-rate-limit |
| Email | Nodemailer; environment-dependent email configuration |
| Reporting and analytics | Chart.js, ExcelJS |
| Deployment | Render, MongoDB Atlas |
| Development tools | Git, GitHub, Visual Studio Code |

The stack above is based on the published backend `package.json` and repository deployment instructions.

## Project Structure

```text
renz-barbershop/
├── backend/                     # Express server, API and database logic
│   ├── server.js                # Backend entry point
│   ├── seed.js                  # Initial data setup
│   ├── package.json             # Backend dependencies and npm scripts
│   ├── routes/                  # Feature-specific routes
│   ├── middleware/              # Access control and middleware
│   ├── utils/                   # Common server utilities
│   ├── scripts/                 # Backup and restore commands
│   └── tests/                   # Automated tests
├── frontend/                    # Browser interface and client-side files
├── render.yaml                  # Render service configuration
├── DEPLOY-GITHUB-RENDER.md      # Additional deployment instructions
├── PAANO-I-RUN.txt              # Local running instructions
├── README-STRUCTURE.md          # Frontend restructuring notes
└── README.md                    # Project documentation
```

> The frontend layout has been restructured over time. See `README-STRUCTURE.md` and the current `frontend/` directory for the exact file names in your checked-out revision.

## Getting Started

### Prerequisites

- **Node.js 20 or newer** and npm
- A running MongoDB server or MongoDB Atlas database
- Git (optional if downloading a ZIP)
- A code editor such as Visual Studio Code

### 1. Clone the Repository

```bash
git clone https://github.com/Eylizer0101/renz-barbershop.git
cd renz-barbershop
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

The existing setup documentation runs the application through the backend; no separate frontend development command is required by that documented workflow.

### 3. Configure Environment Variables

If your checked-out `backend/` directory includes `.env.example`, copy it to `.env` and update the values. Otherwise, create a private `backend/.env` file based on the configuration expected by your current backend.

Example configuration (replace all example values):

```dotenv
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017
DB_NAME=barbershop
JWT_SECRET=replace-with-a-long-random-secret-at-least-32-characters
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-password
CASHIER_EMAIL=cashier@example.com
CASHIER_PASSWORD=replace-with-a-strong-password
TZ=Asia/Manila
```

The example above illustrates the variables referenced by published setup notes; **it is not a verified, exhaustive copy of the current `.env.example`**. Confirm any additional email, session, host, or provider variables in the current backend code and deployment settings.

To create a random secret locally:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Never commit `.env` files, database passwords, email credentials, or other secrets to GitHub.**

### 4. Seed Initial Records (Only for a New Database)

```bash
npm run seed
```

The repository describes the seed script as a way to create initial accounts and sample records. **Do not run this against an existing production database without checking the script and backing up the database first.**

### 5. Start the Application

```bash
npm start
```

Or start the Node.js server in watch mode during development:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

The published setup guide uses port `3000`. Check the terminal output if you configured a different port.

## Available npm Scripts

Run these commands from the **`backend/`** directory.

| Command | Purpose |
| --- | --- |
| `npm start` | Start the backend server |
| `npm run dev` | Start the server with Node.js watch mode |
| `npm run seed` | Run the database seeding script |
| `npm test` | Execute the repository's smoke tests |
| `npm run backup` | Create a database backup |
| `npm run restore` | Run the backup restoration script |

Avoid running tests, seeding, or restore commands against important real customer data. Test behavior should be inspected before use.

## Deployment to Render

The repository includes a `render.yaml` blueprint and a deployment guide. Its recorded configuration uses the following commands from the repository root:

```bash
# Build
npm ci --prefix backend

# Start
npm start --prefix backend
```

Configure environment values in Render rather than uploading a production `.env` file. Relevant settings documented in the repository include:

| Variable | Description |
| --- | --- |
| `NODE_ENV` | Set to `production` |
| `MONGODB_URI` | Secure database connection string |
| `DB_NAME` | Name of the MongoDB database |
| `JWT_SECRET` | Strong, confidential signing key |
| `TZ` | `Asia/Manila` for the shop's configured time zone |
| `TRUST_PROXY` | Set according to the deployed reverse proxy configuration |

Configure any email-provider credentials required by the active authentication flow. Render assigns the service port for its environment, so do not override `PORT` without a specific reason.

For the longer instructions, refer to [`DEPLOY-GITHUB-RENDER.md`](DEPLOY-GITHUB-RENDER.md).

**File-upload limitation:** The published deployment guide says barber photos are stored on the server's local filesystem. On an ephemeral deployment, newly uploaded files may be lost across restarts or deployments. Use durable object storage or a supported persistent disk before depending on uploads in production.

## Security and Privacy

The repository includes security-related dependencies and documents practices such as:

- Password hashing using `bcryptjs`.
- Protected requests and role-based authorization checks.
- Authentication token or session handling.
- HTTP response protections with Helmet.
- Rate limiting on applicable endpoints.
- Activity records for sensitive operational changes.
- Limits on access to customer and payment information.

These items describe the published design and included security tooling; they are **not a substitute for an independent security audit**. Before handling real customers' information:

1. Deploy behind HTTPS and configure proxy/session settings correctly.
2. Use strong passwords and unique production secrets.
3. Restrict MongoDB access and limit database account permissions.
4. Verify each role's access to protected pages and API endpoints.
5. Protect backups and keep them outside the public repository.
6. Confirm production email verification or sign-in codes work as intended.
7. Keep dependencies updated and test critical workflows before release.

## Testing

From the backend directory:

```bash
npm test
```

This runs the script defined in `backend/package.json` (`tests/smoke.js`). Check its test database configuration before running it, especially if your environment points to a live MongoDB Atlas database.

For manual checks, review login, queue status, walk-in processing, appointments, payments, inventory, staff permissions, and mobile layouts as appropriate to the features currently implemented.

## Troubleshooting

| Issue | What to check |
| --- | --- |
| Server does not start | Node.js version, `backend/` working directory, installed dependencies, and terminal logs |
| Database connection fails | `MONGODB_URI`, database credentials, network access, and MongoDB service status |
| Login or verification fails | Initial accounts, credentials, session settings, and email configuration |
| Missing records | Database name, selected MongoDB deployment, and whether initial data was added |
| Images disappear after deployment | Whether uploads are stored on an ephemeral filesystem |
| Unexpected permission errors | Account role and server-side authorization rules |

## Project Documentation

- [`DEPLOY-GITHUB-RENDER.md`](DEPLOY-GITHUB-RENDER.md) — GitHub and Render deployment notes
- [`PAANO-I-RUN.txt`](PAANO-I-RUN.txt) — Local run instructions
- [`README-STRUCTURE.md`](README-STRUCTURE.md) — Frontend file restructuring notes and known placeholders

## Developer

**Eylizer De Afria**  
Bachelor of Science in Information Technology, major in System Development  
PHINMA Araullo University

- **Portfolio:** https://eylizer-portfolio.onrender.com
- **GitHub:** https://github.com/Eylizer0101
- **LinkedIn:** https://www.linkedin.com/in/eylizer-de-afria-040724430

## License and Usage

**Copyright © 2026 Eylizer De Afria. All rights reserved.**

This project is shared for educational, demonstration, and portfolio-review purposes. Public visibility does not, by itself, grant permission to copy, modify, redistribute, sublicense, or commercially exploit the source code. Obtain permission from the relevant copyright holder(s) before doing so, except where applicable law or separate third-party licenses permit otherwise.

This notice applies only to rights owned by the named copyright holder; third-party packages and any other contributors' work remain subject to their respective rights and licenses. A repository-wide `LICENSE` file should be added if a specific license is intended in the future.
