import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import WebTorrent from 'webtorrent';
import { Client, Databases, ID } from 'node-appwrite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { Bot: TelegramBot } = require('node-telegram-bot-api');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors());

const client = new WebTorrent();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const appwriteClient = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(appwriteClient);

app.get('/', (req, res) => {
    res.send('SinhalaHub Backend is running successfully!');
});

app.post('/upload-torrent', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.ADMIN_API_KEY) {
        return res.status(403).json({ success: false, error: 'Unauthorized API Key' });
    }

    const { magnet, title, description, thumbnail, category } = req.body;

    if (!magnet || !title) {
        return res.status(400).json({ success: false, error: 'Magnet link and title are required' });
    }

    console.log(`Starting torrent download for: ${title}`);

    client.add(magnet, { path: path.join(__dirname, 'downloads') }, async (torrent) => {
        console.log('Torrent downloading: ' + torrent.infoHash);

        torrent.on('done', async () => {
            console.log('Torrent download finished!');
            
            try {
                const file = torrent.files.find(file => 
                    file.name.endsWith('.mp4') || file.name.endsWith('.mkv') || file.name.endsWith('.avi')
                );

                if (!file) {
                    throw new Error('No video file found in torrent!');
                }

                const filePath = path.join(torrent.path, file.path);
                console.log(`Uploading video to Telegram: ${file.name}`);

                const sentMsg = await bot.sendVideo(CHANNEL_ID, fs.createReadStream(filePath), {
                    caption: `🎬 **${title}**\n\n${description || ''}`
                }, {
                    timeout: 600000
                });

                const fileId = sentMsg.video.file_id;
                const fileObj = await bot.getFile(fileId);
                const streamUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileObj.file_path}`;

                await databases.createDocument(
                    process.env.APPWRITE_DATABASE_ID,
                    process.env.APPWRITE_COLLECTION_ID,
                    ID.unique(),
                    {
                        title: title,
                        description: description || '',
                        thumbnail: thumbnail || '',
                        category: category || 'Movies',
                        streamUrl: streamUrl
                    }
                );

                console.log('Successfully saved to Appwrite Database!');

                torrent.destroy(() => {
                    console.log('Torrent client destroyed & temp files cleaned.');
                });

            } catch (err) {
                console.error('Error during Telegram upload or Appwrite save:', err);
            }
        });

        torrent.on('error', (err) => {
            console.error('Torrent error:', err.message);
        });
    });

    res.status(200).json({ 
        success: true, 
        message: 'Torrent download and upload process started in background.' 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});