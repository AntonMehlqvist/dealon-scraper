const dotenv = require("dotenv");
dotenv.config();

module.exports = {
  apps: [
    {
      name: "dealon-scraper",
      append_env_to_name: true,
      script: "dist/index.js",
      env_prod: {
        NODE_ENV: "production",
        ...process.env,
      },
      env_staging: {
        NODE_ENV: "production",
        ...process.env,
      },
      max_memory_restart: "3G",
    },
  ],
};
