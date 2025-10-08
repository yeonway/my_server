// filepath: c:\Users\HOME\Desktop\python\my_server\scripts\migrate_post_image_paths.js
require('dotenv').config();
const mongoose = require('mongoose');
const Post = require('../models/post');

(async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/my_server';
    await mongoose.connect(uri);
    console.log('[연결] MongoDB 연결 성공');

    const posts = await Post.find({ images: { $exists: true, $ne: [] } });
    let changedDocs = 0;
    let changedImages = 0;

    for (const p of posts) {
      let modified = false;
      const newArr = p.images.map(img => {
        if (!img) return img;
        let newPath = img;
        if (img.indexOf('/posts_files/') !== -1) {
          newPath = img.replace('/posts_files/', '/uploads/posts/');
        } else if (img.startsWith('posts_files/')) {
          newPath = img.replace('posts_files/', '/uploads/posts/');
        }
        if (newPath !== img) {
          modified = true;
          changedImages++;
        }
        return newPath;
      });

      if (modified) {
        p.images = newArr;
        await p.save();
        changedDocs++;
        console.log('변경: Post ' + p._id);
      }
    }

    console.log('--------------------------------');
    console.log('총 검사 게시글: ' + posts.length);
    console.log('수정된 문서 수: ' + changedDocs);
    console.log('수정된 이미지 항목 수: ' + changedImages);
  } catch (e) {
    console.error('[오류] ' + e.message);
  } finally {
    await mongoose.disconnect();
    console.log('[종료] MongoDB 연결 해제');
  }
})();
