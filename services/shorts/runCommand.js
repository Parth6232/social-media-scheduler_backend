// Shell command runner — yt-dlp / ffmpeg ke liye helper
const { spawn } = require("child_process");

/**
 * Run a command, stream stdout/stderr line-by-line.
 * @param {string} bin  - executable path
 * @param {string[]} args
 * @param {{ onLine?: (line: string) => void }} [opts]
 * @returns {Promise<void>}
 */
function run(bin, args = [], opts = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        const onLine = opts.onLine || (() => {});

        let buf = "";
        const handleChunk = (chunk) => {
            buf += chunk.toString();
            const lines = buf.split(/\r?\n/);
            buf = lines.pop(); // incomplete last line
            for (const line of lines) {
                if (line.trim()) onLine(line);
            }
        };

        proc.stdout.on("data", handleChunk);
        proc.stderr.on("data", handleChunk);

        proc.on("error", (err) => reject(new Error(`Failed to start "${bin}": ${err.message}`)));
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`"${bin}" exited with code ${code}`));
        });
    });
}

/**
 * Run a command and return its combined stdout as a string.
 * @param {string} bin
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function capture(bin, args = []) {
    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        proc.stdout.on("data", (d) => { out += d.toString(); });
        proc.stderr.on("data", (d) => { err += d.toString(); });
        proc.on("error", (e) => reject(new Error(`Failed to start "${bin}": ${e.message}`)));
        proc.on("close", (code) => {
            if (code === 0) resolve(out);
            else reject(new Error(`"${bin}" exited with code ${code}. stderr: ${err.slice(0, 500)}`));
        });
    });
}

module.exports = { run, capture };
