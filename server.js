import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ✅ CORS
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("Lead Sync API running");
});

// =========================
// CONTACT PRELOAD (WITH BOUNCE)
// =========================
app.get("/contacts/preload", async (req, res) => {
  try {
    const response = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,email,company,jobtitle,hs_email_hard_bounce_reason",
      {
        headers: {
          Authorization: `Bearer ${process.env.Private_App_Token}`
        }
      }
    );

    const data = await response.json();

    const contacts = data.results.map(c => ({
      id: c.id,
      first: c.properties.firstname,
      last: c.properties.lastname,
      email: c.properties.email,
      company: c.properties.company,
      title: c.properties.jobtitle,
      bounce: c.properties.hs_email_hard_bounce_reason ? "known" : "unknown"
    }));

    res.json({ contacts });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// MAIN SYNC ENDPOINT
// =========================
app.post("/sync/lead", async (req, res) => {
  const payload = req.body;

  try {
    const c = payload.extracted;

    if (!c) {
      return res.status(400).json({ error: "Missing contact data" });
    }

    const email = c.email?.trim();

    console.log("🔵 Incoming contact:", c);

    // =========================
    // 1️⃣ UPDATE BY ID
    // =========================
    if (c.hubspotId) {
      console.log("🟢 Updating via ID:", c.hubspotId);

      const updateRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${c.hubspotId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.Private_App_Token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            properties: {
              firstname: c.firstName,
              lastname: c.lastName,
              email,
              company: c.company,
              jobtitle: c.jobTitle,
              phone: c.phoneNumber
            }
          })
        }
      );

      const data = await updateRes.json();

      if (!updateRes.ok) {
        return res.status(updateRes.status).json({
          error: "Update by ID failed",
          details: data
        });
      }

      return res.json({ success: true, mode: "update_by_id", data });
    }

    // =========================
    // 2️⃣ EMAIL FALLBACK
    // =========================
    if (!email) {
      return res.status(400).json({
        error: "No email and no hubspotId"
      });
    }

    console.log("🟡 Falling back to email:", email);

    const searchRes = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts/search",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.Private_App_Token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: email
                }
              ]
            }
          ]
        })
      }
    );

    const searchData = await searchRes.json();

    // =========================
    // 2a️⃣ FOUND → UPDATE
    // =========================
    if (searchData.total > 0) {
      const contactId = searchData.results[0].id;

      console.log("🟢 Updating via email match:", contactId);

      const updateRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${process.env.Private_App_Token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            properties: {
              firstname: c.firstName,
              lastname: c.lastName,
              email,
              company: c.company,
              jobtitle: c.jobTitle,
              phone: c.phoneNumber
            }
          })
        }
      );

      const data = await updateRes.json();

      return res.json({
        success: true,
        mode: "update_by_email",
        data
      });
    }

    // =========================
    // 2b️⃣ CREATE
    // =========================
    console.log("🔵 Creating new contact");

    const createRes = await fetch(
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
            email,
            company: c.company,
            jobtitle: c.jobTitle,
            phone: c.phoneNumber
          }
        })
      }
    );

    const data = await createRes.json();

    // 🔁 HANDLE DUPLICATE CONFLICT
    if (!createRes.ok) {
      const message = data?.message || "";

      if (message.includes("already has that value")) {
        console.log("🔁 Duplicate detected → retry update");

        const retrySearch = await fetch(
          "https://api.hubapi.com/crm/v3/objects/contacts/search",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.Private_App_Token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              filterGroups: [
                {
                  filters: [
                    {
                      propertyName: "email",
                      operator: "EQ",
                      value: email
                    }
                  ]
                }
              ]
            })
          }
        );

        const retryData = await retrySearch.json();

        if (retryData.total > 0) {
          const contactId = retryData.results[0].id;

          const updateRes = await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
            {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${process.env.Private_App_Token}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                properties: {
                  firstname: c.firstName,
                  lastname: c.lastName,
                  email,
                  company: c.company,
                  jobtitle: c.jobTitle,
                  phone: c.phoneNumber
                }
              })
            }
          );

          const updateData = await updateRes.json();

          return res.json({
            success: true,
            mode: "retry_update_after_conflict",
            data: updateData
          });
        }
      }

      return res.status(createRes.status).json({
        error: "Create failed",
        details: data
      });
    }

    return res.json({
      success: true,
      mode: "create",
      data
    });

  } catch (err) {
    console.error("🔴 Server error:", err);

    res.status(500).json({
      error: "Server error",
      message: err.message
    });
  }
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
