const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const { generateToken, generateRefreshToken } = require('../utils/jwt');
const { uploadAvatarFromUrl } = require('../utils/cloudinary');

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      proxy: true
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.trim().toLowerCase();
        const googleId = typeof profile.id === 'string' ? profile.id.trim() : '';
        const avatar = profile.photos?.[0]?.value;
        const displayName = profile.displayName;

        if (!googleId) {
          return done(null, false, { message: 'Google identity not provided.' });
        }

        // Only the verified provider subject identifies a linked account.
        let user = await User.findOne({ googleId });
        if (!user) {
          const verifiedEmail = profile.emails?.[0]?.verified === true || profile._json?.email_verified === true;
          if (!email || !verifiedEmail) {
            return done(null, false, { message: 'A verified Google email is required to create an account.' });
          }
          if (await User.findOne({ email })) {
            return done(null, false, { message: 'An account already uses this email. Sign in before linking Google.' });
          }
        }

        if (user?.isSystemAccount || user?.userType === 'system') {
          return done(null, false, { message: 'Account is unavailable.' });
        }

        if (user?.userType === 'admin') {
          return done(null, false, {
            message: 'Admin accounts must sign in through the dedicated Admin Portal.'
          });
        }

        if (user && !user.isActive) {
          return done(null, false, { message: 'Account is deactivated.' });
        }

        // Handle avatar upload to Cloudinary (fallback to Google URL if upload fails)
        let avatarUrl = avatar || '';
        if (avatar) {
          try {
            const uploadResult = await uploadAvatarFromUrl(avatar);
            avatarUrl = uploadResult.url;
          } catch (uploadError) {
            console.error('Failed to upload Google avatar to Cloudinary:', uploadError.message);
            // Keep Google-hosted avatar as fallback if upload fails
            avatarUrl = avatar;
          }
        }

        if (!user) {
          // Generate short temporary username (max 20 chars)
          // Format: g_<14randomchars> = 16 chars (safe, leaves room for counter)
          const randomStr = Math.random().toString(36).substring(2, 10) + Date.now().toString(36).substring(2, 10);
          let baseUsername = `g_${randomStr.substring(0, 14)}`; // 16 chars: "g_" + 14 chars
          
          // Ensure username is unique and stays under 20 chars
          let checkUser = await User.findOne({ username: baseUsername });
          let finalUsername = baseUsername;
          let counter = 1;
          while (checkUser && counter < 1000) { // Safety limit
            // Calculate max substring length: g_ + substring + counter <= 20
            // So substring <= 18 - counter.length
            const maxSubstringLength = 18 - counter.toString().length;
            const substring = randomStr.substring(0, maxSubstringLength);
            finalUsername = `g_${substring}${counter}`;
            
            // Double check length (should always be <= 20)
            if (finalUsername.length > 20) {
              finalUsername = `g_${randomStr.substring(0, 15)}${counter}`.substring(0, 20);
            }
            
            checkUser = await User.findOne({ username: finalUsername });
            counter++;
          }
          
          // Create temporary user for Google OAuth without username/password
          // User will set these on profile completion page
          try {
            user = await User.create({
              email,
              googleId,
              username: finalUsername, // Temporary unique username until onboarding
              password: require('crypto').randomBytes(32).toString('hex'),
              userType: 'player',
              profile: {
                displayName: typeof displayName === 'string' ? displayName.trim() : '',
                avatar: avatarUrl
              },
              needsProfileCompletion: true,
              requiresPasswordSetup: true,
              isActive: true
            });
          } catch (createError) {
            if (createError?.code !== 11000) throw createError;
            user = await User.findOne({ googleId });
            if (!user) return done(null, false, { message: 'An account already uses this email. Sign in before linking Google.' });
          }
        } else {
          // Update existing user
          if (avatarUrl && !user.profile.avatar) {
            user.profile.avatar = avatarUrl;
          }
          user.lastSeen = new Date();
          await user.save();
        }

        if (user.isSystemAccount || user.userType === 'system') return done(null, false, { message: 'Account is unavailable.' });
        if (user.userType === 'admin') return done(null, false, { message: 'Admin accounts must sign in through the dedicated Admin Portal.' });
        if (!user.isActive) return done(null, false, { message: 'Account is deactivated.' });

        // Generate JWT tokens
        const token = generateToken({ 
          id: user._id, 
          username: user.username, 
          userType: user.userType 
        });
        const refresh = generateRefreshToken({ id: user._id });

        // Pass tokens and user info to callback route
        return done(null, { user, token, refresh });
      } catch (err) {
        console.error('Google OAuth error:', err);
        return done(err, false);
      }
    }
  )
);

module.exports = passport;

