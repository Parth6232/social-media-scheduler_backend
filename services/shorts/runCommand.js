const { spawn, execFile } = require("child_process");

// Koi bhi command (ffmpeg, yt-dlp, python) chalata hai. Shell use NAHI hota,
// isliye user ka diya text kabhi command me inject nahi ho sakta.
function run(cmd, args, { cwd, onLine } = {}) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(cmd, args, { cwd, windowsHide: true });
        } catch (e) {
            return reject(e);
        }
        let tail = "";
        const feed = (chunk) => {
            const text = chunk.toString();
            tail = (tail + text).slice(-4000);
            if (onLine) text.split(/\r?\n|\r/).forEach((l) => l.trim() && onLine(l.trim()));
        };
        child.stdout.on("data", feed);
        child.stderr.on("data", feed);
        child.on("error", (err) => {
            if (err.code === "ENOENT") reject(new Error(`"${cmd}" install nahi hai ya PATH me nahi mila`));
            else reject(err);
        });
        child.on("close", (code) =>
            code === 0 ? resolve(tail) : reject(new Error(`${cmd} fail hua (code ${code}): ${tail.slice(-800)}`))
        );
    });
}

// stdout wapas chahiye (jaise ffprobe JSON)
function capture(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
            if (err) {
                if (err.code === "ENOENT") return reject(new Error(`"${cmd}" install nahi hai ya PATH me nahi mila`));
                return reject(new Error(`${cmd} fail hua: ${(stderr || err.message).slice(-500)}`));
            }
            resolve(stdout);
        });
    });
}

module.exports = { run, capture };
