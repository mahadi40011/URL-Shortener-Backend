require("dotenv").config();
const express = require("express");
const { customAlphabet } = require("nanoid");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  // console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    // console.log({decoded});
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("URl-Shortener");
    const urlsCollection = db.collection("URLs");

    //generate shortCode and date save into database
    app.post("/generate-shortCode", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const { longUrl } = req.body;
      const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
      const generateShortCode = customAlphabet(alphabet, 8);

      if (!longUrl) {
        return res.status(400).send({ message: "Long URL is required" });
      }

      try {
        const existingEntry = await urlsCollection.findOne({
          longUrl: longUrl,
        });

        if (existingEntry) {
          return res.status(200).send({
            shortCode: existingEntry.shortCode,
            message: "Short URL generated successfully",
          });
        }

        const shortCode = generateShortCode();

        const newUrlEntry = {
          email,
          longUrl,
          shortCode,
          createdAt: new Date(),
          totalVisit: 0,
        };

        const result = await urlsCollection.insertOne(newUrlEntry);

        res.status(201).send({
          shortCode: shortCode,
          message: "Short URL generated successfully",
        });
      } catch (error) {
        console.error("Generation Error:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    // get all urls data filtered by user email
    app.get("/all-urls", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const result = await urlsCollection.find({ email }).toArray();
        res.status(200).send(result);
      } catch (error) {
        console.error("Error fetching URLs:", error);
        res.status(500).send({
          success: false,
          message: "Internal Server Error. Could not fetch URLs.",
        });
      }
    });

    // Dynamic route for redirect to the original URL
    app.get("/:shortCode", async (req, res) => {
      try {
        const { shortCode } = req.params;
        const urlEntry = await urlsCollection.findOne({ shortCode: shortCode });

        if (urlEntry) {
          await urlsCollection.updateOne(
            { shortCode: shortCode },
            { $inc: { totalVisit: 1 } }
          );

          return res.redirect(urlEntry.longUrl);
        } else {
          return res.status(404).send(`
        <html>
          <body style="text-align: center; padding-top: 50px; font-family: sans-serif;">
            <h1 style="color: #ff4d4d;">404 - Link Not Found!</h1>
            <p>Sorry, the short link you are looking for is invalid or has expired.</p>
            <a href="${process.env.CLIENT_DOMAIN}">Go to Homepage</a>
          </body>
        </html>
      `);
        }
      } catch (error) {
        console.error("Redirect error:", error);
        res.status(500).send("Internal Server Error");
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
