const fs = require('fs');
let code = fs.readFileSync('src/data/api-repository.test.ts', 'utf8');

code = code.replace(/it\("throws an ApiError with the envelope code when the operator is signed out \(401\)", async \(\) => {\s+errorResponse/g, 
  'it("throws an ApiError with the envelope code when the operator is signed out (401)", async () => {\n    mockFetch(() => errorResponse');

code = code.replace(/it\("maps a non-2xx error envelope to a descriptive ApiError", async \(\) => {\s+errorResponse/g, 
  'it("maps a non-2xx error envelope to a descriptive ApiError", async () => {\n    mockFetch(() => errorResponse');

// A more generic regex: replace `    \n      ` with `    mockFetch(() => `
code = code.replace(/^\s*\n\s+errorResponse/gm, '\n    mockFetch(() => errorResponse');
code = code.replace(/^\s+new Response/gm, '    mockFetch(() => new Response');
code = code.replace(/^\s*\n\s+jsonResponse/gm, '\n    const calls = mockFetch(() => jsonResponse');

fs.writeFileSync('src/data/api-repository.test.ts', code);
