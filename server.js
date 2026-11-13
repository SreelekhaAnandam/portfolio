require("dotenv").config();

const express = require("express");
const session = require("express-session");
const { OAuth2Client } = require("google-auth-library");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const winston = require("winston");

const app = express();
const PORT = process.env.PORT || 5000;

// ---------------- WINSTON LOGGER SETUP (ELK Stack Ready) ----------------

const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: path.join(__dirname, "logs/app.log") }),
        new winston.transports.Console()
    ]
});

// Ensure logs directory exists
const logDir = path.join(__dirname, "logs");
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// ---------------- CONFIGURATION ----------------

const googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID
);

const gmailOAuth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

const TOKEN_PATH = path.join(__dirname, "gmail-token.json");

const allowedEmails = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

// ---------------- MIDDLEWARE ----------------

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "supersecretkey",
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 30 * 60 * 1000
        }
    })
);

// Only public login files should be inside this folder.
app.use(express.static(path.join(__dirname, "public")));

// Request logging middleware for ELK/Grafana monitoring visibility
app.use((req, res, next) => {
    logger.info({
        method: req.method,
        url: req.url,
        ip: req.ip,
        timestamp: new Date().toISOString()
    });
    next();
});

// ---------------- HOME PAGE ----------------

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------------- GMAIL AUTHORIZATION ----------------

app.get("/authorize-gmail", (req, res) => {
    const authUrl = gmailOAuth.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "https://www.googleapis.com/auth/gmail.send"
        ]
    });

    res.redirect(authUrl);
});

// ---------------- GMAIL CALLBACK ----------------

app.get("/oauth2callback", async (req, res) => {
    try {
        const { code } = req.query;

        if (!code) {
            return res.status(400).send("Authorization code missing.");
        }

        const { tokens } = await gmailOAuth.getToken(code);

        gmailOAuth.setCredentials(tokens);

        fs.writeFileSync(
            TOKEN_PATH,
            JSON.stringify(tokens, null, 2)
        );

        logger.info("Gmail client authorized and token saved successfully.");

        res.send(`
            <h2>Gmail Connected Successfully!</h2>
            <p>You can now send OTP emails.</p>
            <a href="/">Open Portfolio Login</a>
        `);

    } catch (error) {
        logger.error("Gmail authorization error: " + error.message);
        res.status(500).send("Gmail authorization failed.");
    }
});

// ---------------- LOAD GMAIL CLIENT ----------------

async function getGmailClient() {
    if (!fs.existsSync(TOKEN_PATH)) {
        throw new Error(
            "Gmail is not connected. Visit /authorize-gmail first."
        );
    }

    const tokens = JSON.parse(
        fs.readFileSync(TOKEN_PATH, "utf8")
    );

    gmailOAuth.setCredentials(tokens);

    const gmail = google.gmail({
        version: "v1",
        auth: gmailOAuth
    });

    return gmail;
}

// ---------------- SEND OTP EMAIL ----------------

async function sendOTPEmail(email, otp) {
    const gmail = await getGmailClient();

    const sender = process.env.GMAIL_SENDER_EMAIL;

    const subject = "Your Portfolio Login Verification Code";

    const message = `
Hello,

Your portfolio verification OTP is:

${otp}

This OTP is valid for 5 minutes.

If you did not request this code, please ignore this email.

Regards,
Portfolio Security Team
`;

    const emailContent = [
        `From: ${sender}`,
        `To: ${email}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        message
    ].join("\n");

    const encodedMessage = Buffer
        .from(emailContent)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    await gmail.users.messages.send({
        userId: "me",
        requestBody: {
            raw: encodedMessage
        }
    });
}

// ---------------- VERIFY GOOGLE SIGN-IN & SEND OTP ----------------

app.post("/api/send-otp", async (req, res) => {
    try {
        const { credential } = req.body;

        if (!credential) {
            return res.status(400).json({
                success: false,
                message: "Google login credential is missing."
            });
        }

        // Verify Google ID token
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();

        const email = payload.email?.trim().toLowerCase();

        // Check verified Google email
        if (!email || !payload.email_verified) {
            logger.warn(`Unverified Google sign-in attempt from email: ${email}`);
            return res.status(401).json({
                success: false,
                message: "Please use a verified Google email."
            });
        }

        // Check authorized email addresses
        if (!allowedEmails.includes(email)) {
            logger.warn(`Unauthorized access attempt blocked for email: ${email}`);
            return res.status(403).json({
                success: false,
                message: "Access denied! This email is not authorized."
            });
        }

        // Generate 6-digit OTP
        const otp = crypto.randomInt(100000, 1000000).toString();

        // Store OTP in session
        req.session.pendingEmail = email;
        req.session.otp = otp;
        req.session.otpExpiry = Date.now() + 5 * 60 * 1000;
        req.session.otpAttempts = 0;
        req.session.verified = false;

        // Send OTP
        await sendOTPEmail(email, otp);

        logger.info(`OTP successfully generated and sent to authorized email: ${email}`);

        res.json({
            success: true,
            message: "OTP sent successfully to your authorized email."
        });

    } catch (error) {
        logger.error("OTP sending error: " + error.stack);

        res.status(500).json({
            success: false,
            message: "Unable to send OTP. Please check Gmail connection."
        });
    }
});

// ---------------- VERIFY OTP ----------------

app.post("/api/verify-otp", (req, res) => {
    const { otp } = req.body;

    if (!req.session.otp || !req.session.pendingEmail) {
        return res.status(400).json({
            success: false,
            message: "Please request a new OTP."
        });
    }

    // Check OTP expiry
    if (Date.now() > req.session.otpExpiry) {
        delete req.session.otp;
        delete req.session.otpExpiry;

        return res.status(400).json({
            success: false,
            message: "OTP expired. Please request a new one."
        });
    }

    // Limit incorrect attempts
    req.session.otpAttempts = (req.session.otpAttempts || 0) + 1;

    if (req.session.otpAttempts > 5) {
        logger.warn(`Max incorrect OTP attempts exceeded for pending session email.`);
        delete req.session.otp;
        delete req.session.pendingEmail;

        return res.status(429).json({
            success: false,
            message: "Too many incorrect attempts. Please log in again."
        });
    }

    // Check OTP match
    if (String(otp).trim() !== req.session.otp) {
        return res.status(401).json({
            success: false,
            message: "Incorrect OTP. Please try again."
        });
    }

    // OTP is correct - Regenerate session securely
    req.session.regenerate((error) => {
        if (error) {
            logger.error("Session regeneration failed: " + error.message);
            return res.status(500).json({
                success: false,
                message: "Session creation failed."
            });
        }

        req.session.verified = true;
        req.session.email = req.body.email || null;

        // Save the authenticated session
        req.session.save((saveError) => {
            if (saveError) {
                logger.error("Session save failed: " + saveError.message);
                return res.status(500).json({
                    success: false,
                    message: "Unable to save login session."
                });
            }

            logger.info("User successfully passed 2FA and logged into the portfolio.");

            res.json({
                success: true,
                message: "OTP verified successfully!"
            });
        });
    });
});

// ---------------- PROTECTED PORTFOLIO ----------------

app.get("/portfolio", (req, res) => {
    if (!req.session.verified) {
        return res.redirect("/");
    }

    res.sendFile(
        path.join(__dirname, "private", "portfolio.html")
    );
});

// ---------------- CHECK LOGIN STATUS ----------------

app.get("/api/check-auth", (req, res) => {
    res.json({
        authenticated: req.session.verified === true
    });
});

// ---------------- LOGOUT ----------------

app.post("/api/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            logger.error("Logout session destruction failed.");
            return res.status(500).json({
                success: false,
                message: "Logout failed."
            });
        }

        res.clearCookie("connect.sid");

        logger.info("User logged out successfully.");

        res.json({
            success: true,
            message: "Logged out successfully."
        });
    });
});

// ---------------- START SERVER ----------------

app.listen(PORT, () => {
    logger.info(`Portfolio server running at http://localhost:${PORT}`);
    console.log(`Portfolio server running at http://localhost:${PORT}`);
});