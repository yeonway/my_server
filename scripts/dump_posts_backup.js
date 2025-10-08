require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Post = require('../models/post');
const BackupPost = require('../models/backupPost');

(async ()=>{
  try{
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/my_server');
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    const outDir = path.join(__dirname,'..','uploads','archive','db_backups');
    if(!fs.existsSync(outDir)) fs.mkdirSync(outDir,{recursive:true});
    fs.writeFileSync(path.join(outDir,`posts_${ts}.json`), JSON.stringify(await Post.find({}).lean(),null,2));
    fs.writeFileSync(path.join(outDir,`backupPosts_${ts}.json`), JSON.stringify(await BackupPost.find({}).lean(),null,2));
    console.log('OK');
  }catch(e){ console.error(e.message); }
  finally { await mongoose.disconnect(); }
})();