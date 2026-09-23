### Demo

https://code-sync.codersgyan.com/

### Local development

Install dependencies and start the production build:

```powershell
npm install
npm start
```

Open `http://localhost:5000`. The Run Code button sends the selected file to
Judge0 through the local `/api/execute` endpoint. You can change the execution
service with the `JUDGE0_URL` environment variable.

The editor detects these common extensions: JavaScript, TypeScript, Python,
Java, C, C++, C#, Go, Rust, Ruby, PHP, Kotlin, Swift, SQL, HTML, and CSS.
HTML and CSS are not executed by Judge0; instead they render in a sandboxed
preview iframe. Running an HTML file inlines every CSS/JS file in the room,
and running a CSS file applies it to a sample HTML page. The sidebar supports
creating folders and nested files such as `src/app.js`. Files currently
exist in browser memory for the active room and are lost after a refresh.
