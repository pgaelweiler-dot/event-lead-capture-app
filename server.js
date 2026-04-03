import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ✅ CORS (allows your frontend to call this API)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// ✅ Health check
app.get("/", (req, res) => {
  res.send("Lead Sync API running");
});

// ✅ Main sync endpoint
app.post("/sync/lead", async (req, res) => {
  const payload = req.body;

  try {
    const c = payload.extracted;

    // 🔒 Basic validation
    if (!c || !c.email) {
      return res.status(400).json({
        error: "Email is required"
      });
    }

    // 🔗 Send to HubSpot
    const response = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.Private_App_Token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          properties: {
            firstname: c.firstName,
            lastname: c.lastName,
            email: c.email,
            company: c.company,
            jobtitle: c.jobTitle,
            phone: c.phoneNumber
          }
        })
      }
    );

    const data = await response.json();

    // ❌ HubSpot error handling
    if (!response.ok) {
      return res.status(response.status).json({
        error: "HubSpot error",
        details: data
      });
    }

    // ✅ Success
    res.json({
      success: true,
      data
    });

  } catch (err) {
    res.status(500).json({
      error: "Server error",
      message: err.message
    });
  }
});

// ✅ Scalingo-compatible port
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
