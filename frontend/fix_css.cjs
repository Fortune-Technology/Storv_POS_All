const fs = require('fs');
const files = [
  'd:/The Fortune Tech Projects/CSV_Filter_Project/frontend/src/pages/POSAPI.css', 
  'd:/The Fortune Tech Projects/CSV_Filter_Project/frontend/src/OCR.css'
];

files.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, 'utf8');
    // Replace light text/borders intended for dark backgrounds
    content = content.replace(/rgba\(255,\s*255,\s*255,\s*(0\.\d+)\)/g, 'rgba(0, 0, 0, $1)');
    // Replace Indigo (99, 102, 241) with FutureFoods Green (122, 193, 67)
    content = content.replace(/rgba\(99,\s*102,\s*241/g, 'rgba(122, 193, 67');
    content = content.replace(/rgba\(168,\s*85,\s*247/g, 'rgba(227, 6, 19');
    
    // Convert hex code for indigo text
    content = content.replace(/#c084fc/g, '#e30613'); 
    content = content.replace(/#60a5fa/g, '#5ca336'); // just replace blue with green roughly
    
    fs.writeFileSync(f, content);
    console.log('Fixed', f);
  }
});
