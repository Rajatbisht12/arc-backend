const multer = require('multer');
const log = require('../utils/logger');

// Configure multer for file uploads
const storage = multer.memoryStorage();

// File filter function
const fileFilter = (req, file, cb) => {
  // Check file type
  if (file.fieldname === 'avatar' || file.fieldname === 'images' || file.fieldname === 'image' || file.fieldname === 'cover') {
    // Allow images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed for avatars and images'), false);
    }
  } else if (file.fieldname === 'videos') {
    // Allow videos
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed for videos'), false);
    }
  } else if (file.fieldname === 'media') {
    // Allow images, videos, and audio for posts, stories, and voice messages
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image, video, and audio files are allowed'), false);
    }
  } else if (file.fieldname === 'music') {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed for music'), false);
    }
  } else {
    cb(new Error('Invalid field name'), false);
  }
};

// Configure multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10 // Maximum 10 files
  }
});

const SAFE_FILE_FILTER_MESSAGES = new Set([
  'Only image files are allowed for avatars and images',
  'Only video files are allowed for videos',
  'Only image, video, and audio files are allowed',
  'Only audio files are allowed for music',
  'Invalid field name'
]);

const sendUploadError = (res, err, maxCount = 10) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        code: 'FILE_TOO_LARGE',
        message: 'File too large. Maximum size is 50MB.'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        success: false,
        code: 'TOO_MANY_FILES',
        message: `Too many files. Maximum is ${maxCount} files.`
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        code: 'UNEXPECTED_FILE_FIELD',
        message: 'Unexpected file field.'
      });
    }
  }

  if (SAFE_FILE_FILTER_MESSAGES.has(err?.message)) {
    return res.status(415).json({
      success: false,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: err.message
    });
  }

  log.error('File upload middleware failed', { error: String(err) });
  return res.status(400).json({
    success: false,
    code: 'FILE_UPLOAD_REJECTED',
    message: 'File upload rejected.'
  });
};

// Middleware for different upload types
const uploadSingle = (fieldName) => {
  return (req, res, next) => {
    const uploadSingle = upload.single(fieldName);
    
    uploadSingle(req, res, (err) => {
      if (err) {
        return sendUploadError(res, err, 1);
      }
      next();
    });
  };
};

const uploadMultiple = (fieldName, maxCount = 10) => {
  return (req, res, next) => {
    const uploadMultiple = upload.array(fieldName, maxCount);
    
    uploadMultiple(req, res, (err) => {
      if (err) {
        return sendUploadError(res, err, maxCount);
      }
      next();
    });
  };
};

const uploadFields = (fields) => {
  return (req, res, next) => {
    const uploadFields = upload.fields(fields);
    
    uploadFields(req, res, (err) => {
      if (err) {
        const maxCount = fields.reduce((total, field) => total + Number(field.maxCount || 1), 0);
        return sendUploadError(res, err, maxCount);
      }
      next();
    });
  };
};

module.exports = {
  uploadSingle,
  uploadMultiple,
  uploadFields,
  // Exposed for contract tests; application routes use the middleware above.
  _sendUploadError: sendUploadError
};
