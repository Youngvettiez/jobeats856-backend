// This is the complete, upgraded "gatekeeper" server.
// It now understands the concept of albums.

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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// 2. S3/R2 Client for Secure Link Generation
const S3 = new S3Client({
  region: "auto",
  endpoint: `https://` + process.env.R2_ACCOUNT_ID + `.r2.cloudflarestorage.com`, 
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- API ENDPOINTS ---

// A simple check to see if the API is running.
app.get('/api', (req, res) => res.status(200).send('API is running.'));

// NEW ENDPOINT: Gets the list of all albums for the album grid page.
app.get('/api/albums', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, title, cover_art_url FROM albums ORDER BY id DESC'); // Newest first
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching albums:', error);
    res.status(500).json({ error: 'Internal server error fetching albums' });
  }
});

// NEW ENDPOINT: Gets the list of songs for a SPECIFIC album.
app.get('/api/albums/:albumId/songs', async (req, res) => {
    const { albumId } = req.params;
    try {
        const result = await pool.query('SELECT id, title, artist FROM songs WHERE album_id = $1 ORDER BY id', [albumId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No songs found for this album.' });
        }
        res.status(200).json(result.rows);
    } catch (error) {
        console.error(`Error fetching songs for album ${albumId}:`, error);
        res.status(500).json({ error: 'Internal server error fetching songs for album' });
    }
});


// This is the secure streaming endpoint. It still works the same way.
app.get('/api/songs/:id/stream', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT audio_file_name FROM songs WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }
    const fileName = result.rows[0].audio_file_name;

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
    });

    const signedUrl = await getSignedUrl(S3, command, { expiresIn: 300 });
    
    res.status(200).json({ url: signedUrl });

  } catch (error) {
    console.error(`Error generating stream URL for song ${id}:`, error);
    res.status(500).json({ error: 'Could not generate stream URL' });
  }
});


app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
