const http = require('http');
http.get('http://localhost:5173/public/css/style.css', (res) => {
  console.log("Status:", res.statusCode);
}).on('error', (e) => {
  console.error(e);
});
