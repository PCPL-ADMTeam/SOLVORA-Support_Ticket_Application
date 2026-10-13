module.exports = {
  apps: [{
    name: "solvora",
    cwd: "C:/supporting_ticket_tool/Support-Ticket-Application/server.js",
    script: "src/server.js",

    autorestart: true,
    watch: false,
    node_args: "--max-old-space-size=512",

    max_memory_restart: "700M",
    restart_delay: 5000,
    error_file: "./logs/error.log",
    out_file: "./logs/output.log",
    merge_logs: true,
    time: true
  }]
};