const cloudinary = require('../config/cloudinary');
const { Readable } = require('stream');
const axios = require('axios');

// Upload image to cloudinary
const uploadImage = async (file, folder = 'gaming-social') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'image',
        transformation: [
          { width: 1200, height: 1200, crop: 'limit' },
          { quality: 'auto' },
          { fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            width: result.width,
            height: result.height
          });
        }
      }
    );

    const bufferStream = new Readable();
    bufferStream.push(file.buffer);
    bufferStream.push(null);
    bufferStream.pipe(uploadStream);
  });
};

// Upload video to cloudinary
const uploadVideo = async (file, folder = 'gaming-social') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'video',
        eager: [
          { 
            width: 1280, 
            height: 720, 
            crop: 'fill',
            gravity: 'auto',
            quality: 'auto',
            audio_codec: 'aac',
            video_codec: 'h264'
          }
        ],
        eager_async: true,
        eager_notification_url: null
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            duration: result.duration,
            width: result.width,
            height: result.height
          });
        }
      }
    );

    const bufferStream = new Readable();
    bufferStream.push(file.buffer);
    bufferStream.push(null);
    bufferStream.pipe(uploadStream);
  });
};

// Upload audio (e.g. story music) - Cloudinary treats as video resource
const uploadAudio = async (file, folder = 'gaming-social/audio') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'video'
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url,
            publicId: result.public_id
          });
        }
      }
    );

    const bufferStream = new Readable();
    bufferStream.push(file.buffer);
    bufferStream.push(null);
    bufferStream.pipe(uploadStream);
  });
};

// Upload avatar (smaller size)
const uploadAvatar = async (file, folder = 'gaming-social/avatars') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'image',
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face' },
          { quality: 'auto' },
          { fetch_format: 'auto' }
        ]
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            url: result.secure_url,
            publicId: result.public_id
          });
        }
      }
    );

    const bufferStream = new Readable();
    bufferStream.push(file.buffer);
    bufferStream.push(null);
    bufferStream.pipe(uploadStream);
  });
};

// Upload avatar from URL (for Google OAuth)
const uploadAvatarFromUrl = async (imageUrl, folder = 'gaming-social/avatars') => {
  try {
    // Download image from URL
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // Convert arraybuffer to buffer
    const buffer = Buffer.from(response.data);
    
    // Get content type from response
    const contentType = response.headers['content-type'] || 'image/jpeg';
    
    // Create a file-like object
    const file = {
      buffer: buffer,
      mimetype: contentType,
      originalname: 'avatar.jpg'
    };

    // Upload to Cloudinary using existing uploadAvatar function
    return await uploadAvatar(file, folder);
  } catch (error) {
    console.error('Error uploading avatar from URL:', error.message);
    throw new Error(`Failed to upload avatar from URL: ${error.message}`);
  }
};

// Delete file from cloudinary
const deleteFile = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
};

// Upload multiple files
const uploadMultipleFiles = async (files, folder = 'gaming-social') => {
  const uploadPromises = files.map(file => {
    if (file.mimetype.startsWith('image/')) {
      return uploadImage(file, folder);
    } else if (file.mimetype.startsWith('video/')) {
      return uploadVideo(file, folder);
    } else if (file.mimetype.startsWith('audio/')) {
      return uploadAudio(file, `${folder}/voice-messages`);
    } else {
      throw new Error(`Unsupported file type: ${file.mimetype}`);
    }
  });

  try {
    const results = await Promise.all(uploadPromises);
    return results.map((result, index) => {
      const mime = files[index].mimetype;
      const type = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'video';
      return { type, ...result };
    });
  } catch (error) {
    throw new Error(`Failed to upload files: ${error.message}`);
  }
};

module.exports = {
  uploadImage,
  uploadVideo,
  uploadAudio,
  uploadAvatar,
  uploadAvatarFromUrl,
  deleteFile,
  uploadMultipleFiles
};
