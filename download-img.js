const https = require("https");
const fs = require("fs");

const urls = [
  "https://zunko.jp/sozai/zundamon_s/zzm_zunmon037.png",
  "https://zunko.jp/sozai/zundamon_s/zzm_zunmon036.png",
  "https://zunko.jp/sozai/zundamon_s/zzm_zunmon_3035.png",
];

function tryDownload(url, dest) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      process.stdout.write("status:" + res.statusCode + " url:" + url + "\n");
      if (res.statusCode === 200) {
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(true); });
      } else {
        file.close();
        fs.unlink(dest, () => {});
        resolve(false);
      }
    }).on("error", (e) => {
      process.stdout.write("error:" + e.message + "\n");
      resolve(false);
    });
  });
}

async function main() {
  for (const url of urls) {
    const ok = await tryDownload(url, "public/zundamon.png");
    if (ok) {
      process.stdout.write("Downloaded: " + url + "\n");
      break;
    }
  }
}
main();
