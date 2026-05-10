const fs = require("fs");

const tokenData = {
  access_token: "YOUR_ACCESS_TOKEN",
  refresh_token: "YOUR_REFRESH_TOKEN",
  scope: "general",
  token_type: "Bearer",
  expires_in: 86400
};

fs.writeFileSync("token.json", JSON.stringify(tokenData, null, 2));

console.log("✅ token.json created");