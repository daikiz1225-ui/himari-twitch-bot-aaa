import express from 'express';
import fs from 'fs';

// ====== 【ここにAPIキーやトークンを直接書き込んでください】 ======
const CLIENT_ID = "kz8uvhyodutzolak71mb0ykrfqd1c2";
const CLIENT_SECRET = "esp1w19jvrqug8fb9wgm8gvg76tvup";

const LINE_ACCESS_TOKEN = "HsDoSA+O/W4Z7s2LmpUSg4m/VO5ok0o/MRBnzPR+Bl183Kc7Lj8tKqyoEjQ4AyMpWhRdJ8ae7+gASbDzCVL/L8wUKVK4sikTTsNUgCJ8YPrS+1beXYsbZm5MZqW1MQzZ0C6wBTTK0bTnXx7yWKniQgdB04t89/1O/w1cDnyilFU=";
const LINE_USER_ID = "U273b8c7b36b2b330adda5b2458a8f446";

const CHATWORK_API_TOKEN = "47f3a071fe49e7259100d70071c986b7";
const CHATWORK_ROOM_ID = "440046837";

const YOUTUBE_API_KEY = "ここにYouTubeのAPI_KEYを書く";
// ============================================================

const UPLOADS_PLAYLIST_ID = "UUBA2EDiX5euSTM2Ic3gKqIw";
const STREAMER = "meimeihimari";
const CACHE_FILE = "./.status_cache";

const app = express();
const PORT = process.env.PORT || 3000;

// 画面表示用のステータス文を一時保持する変数
let currentStatusText = "未チェック";

// キャッシュを読み込む関数（多重通知防止用）
function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {
      return { isLive: false, lastVideoId: "" };
    }
  }
  return { isLive: false, lastVideoId: "" };
}

// キャッシュを保存する関数
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// ---------------- LINE (既存機能維持) ----------------

async function sendLineMessage(message) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: LINE_USER_ID,
      messages: [
        {
          type: "text",
          text: message,
        },
      ],
    }),
  });

  console.log("LINE送信:", res.status);

  if (!res.ok) {
    console.log(await res.text());
  }
}

// ---------------- Chatwork (既存機能維持) ----------------

async function sendChatworkMessage(message) {
  const res = await fetch(
    `https://api.chatwork.com/v2/rooms/${CHATWORK_ROOM_ID}/messages`,
    {
      method: "POST",
      headers: {
        "X-ChatWorkToken": CHATWORK_API_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        body: message,
      }),
    }
  );

  console.log("Chatwork送信:", res.status);

  if (!res.ok) {
    console.log(await res.text());
  }
}

// ---------------- YouTube (既存機能維持 + 多重通知防止) ----------------

async function checkYouTube(cache) {
  let ytStatus = "";
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${UPLOADS_PLAYLIST_ID}&maxResults=1&key=${YOUTUBE_API_KEY}`
  );

  const data = await res.json();

  if (!data.items || data.items.length === 0) {
    console.log("YouTube動画なし");
    currentStatusText += "\n[YouTube] 最新動画が見つかりませんでした。";
    return;
  }

  const video = data.items[0];
  const videoId = video.snippet.resourceId.videoId;

  // すでに通知済みの動画IDなら処理をスキップ
  if (cache.lastVideoId === videoId) {
    console.log("YouTube: 既に通知済みの最新動画です");
    currentStatusText += `\n[YouTube] 最新動画: 「${video.snippet.title}」 (通知済み)`;
    return;
  }

  const published = new Date(video.snippet.publishedAt);
  const now = new Date();

  const diffMinutes = (now - published) / 1000 / 60;

  console.log("最新動画:", video.snippet.title);
  console.log(`投稿から ${diffMinutes.toFixed(1)} 分`);

  // 10分以内だけ通知 (元の設定を維持)
  if (diffMinutes <= 10) {
    const message =
`🎥 新しい動画が投稿されました！

📺 タイトル
${video.snippet.title}

🔗 https://youtu.be/${videoId}`;

    await sendLineMessage(message);
    await sendChatworkMessage(message);
    
    // 通知した動画IDを記憶
    cache.lastVideoId = videoId;
    currentStatusText += `\n[YouTube] 新着動画を検知・通知しました！: 「${video.snippet.title}」`;
  } else {
    currentStatusText += `\n[YouTube] 最新動画: 「${video.snippet.title}」 (10分以上前の投稿のため通知対象外)`;
  }
}

// ---------------- Twitch (既存機能維持 + 多重通知防止) ----------------

async function getToken(cache) {
  const tokenRes = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
    {
      method: "POST",
    }
  );

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  const streamRes = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${STREAMER}`,
    {
      headers: {
        "Client-Id": CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const streamData = await streamRes.json();

  if (streamData.data.length > 0) {
    const stream = streamData.data[0];

    console.log("🔴 現在オンライン");
    console.log("タイトル:", stream.title);

    // 前回オフラインだった場合のみ通知を送る（5分ごとの連投を防止）
    if (!cache.isLive) {
      const message =
`🔴 冥鳴ひまり 配信中！

🎮 タイトル
${stream.title}

👥 視聴者数
${stream.viewer_count}人

🔗 https://www.twitch.tv/${STREAMER}`;

      await sendLineMessage(message);
      await sendChatworkMessage(message);
      
      // 状態を配信中に更新
      cache.isLive = true;
      currentStatusText = `[Twitch] 🔴現在配信中！ (新しく通知を送信しました)\nタイトル: ${stream.title}`;
    } else {
      console.log("既に配信中通知を送信済みです");
      currentStatusText = `[Twitch] 🔴現在配信中！ (通知は送信済みです)\nタイトル: ${stream.title}`;
    }

  } else {
    console.log("⚫ 現在オフライン");
    // オフラインになったらフラグを戻す
    cache.isLive = false;
    currentStatusText = "[Twitch] ⚫現在オフラインです";
  }
}

// ---------------- メイン処理 ----------------

async function main() {
  const cache = loadCache();
  
  await getToken(cache);
  await checkYouTube(cache);
  
  saveCache(cache);
}

// ---------------- Webサーバー設定 ----------------

// トップページ（URLそのまま）にアクセスされたら自動チェックして「今何中」を表示する
app.get('/', async (req, res) => {
  const nowStr = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  console.log(`[${nowStr}] 定期チェックアクセスを受信`);
  
  try {
    currentStatusText = ""; // ステータス文字をリセット
    await main();
    
    // ブラウザの画面に分かりやすく状態を表示
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(
`【Bot 動作チェックログ】
実行日時: ${nowStr}

現在のステータス:
--------------------------------------------
${currentStatusText}
--------------------------------------------
チェックが正常に完了しました。`
    );
  } catch (error) {
    console.error("エラー発生:", error);
    res.status(500).send(`エラーが発生しました:\n${error.message}`);
  }
}
);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
