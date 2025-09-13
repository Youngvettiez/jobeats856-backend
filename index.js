// This is the complete, secure "gatekeeper" server.
// It connects to your database and generates temporary, secure links to your music files.

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// --- CONFIGURATION ---

// 1. Database Connection
// This connects to your PostgreSQL database on Render.
// The ssl setting is crucial for a successful connection on Render.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 2. S3/R2 Client for Secure Link Generation
// This configures the connection to your private Cloudflare R2 bucket.
// It uses secret keys that you will set up in Render's environment variables.
const S3 = new S3Client({
  region: "auto",
  // IMPORTANT: You will need to replace <YOUR_ACCOUNT_ID> with your actual Cloudflare Account ID.
  endpoint: `https://49f13a2af01648a298c0bc1cd1fc59a1.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// --- MIDDLEWARE ---
// This allows your player (on a different domain) to communicate with this API.
app.use(cors());
app.use(express.json());

// --- API ENDPOINTS ---

// A simple "health check" to confirm the API is running.
app.get('/api', (req, res) => res.status(200).send('API is running.'));

// This endpoint gets the public list of all songs for your player's playlist.
app.get('/api/songs', async (req, res) => {
  try {
    // It only selects public info (id, title, etc.), not the private filename.
    const result = await pool.query('SELECT id, title, artist, cover_art_url FROM songs ORDER BY id');
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching songs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// This is the secure endpoint for streaming a song.
app.get('/api/songs/:id/stream', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Get the private filename from the database using the song's ID.
    const result = await pool.query('SELECT audio_file_name FROM songs WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }
    const fileName = result.rows[0].audio_file_name;

    // 2. Prepare a command to securely access that specific file in your R2 bucket.
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
    });

    // 3. Generate the special, temporary URL. It will expire in 5 minutes (300 seconds).
    const signedUrl = await getSignedUrl(S3, command, { expiresIn: 300 });

    // 4. Send the secure URL back to the player.
    res.status(200).json({ url: signedUrl });

  } catch (error) {
    console.error(`Error generating stream URL for song ${id}:`, error);
    res.status(500).json({ error: 'Could not generate stream URL' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);

});
