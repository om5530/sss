const { body } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const env = require('../config/env');
const { signToken } = require('../services/token.service');
const { verifyGoogleIdToken } = require('../services/google.service');
const { verifyFirebaseIdToken } = require('../services/firebase.service');
const otpService = require('../services/otp.service');

function sanitizeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar: user.avatar,
    role: user.role,
    addresses: user.addresses,
  };
}

function issueSession(res, user) {
  const token = signToken(user);
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

const googleLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) throw ApiError.badRequest('idToken is required');

  const profile = await verifyGoogleIdToken(idToken);

  let user = await User.findOne({ $or: [{ googleId: profile.googleId }, { email: profile.email }] });
  if (!user) {
    user = await User.create({
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name,
      avatar: profile.avatar,
    });
  } else if (!user.googleId) {
    user.googleId = profile.googleId;
    if (!user.avatar) user.avatar = profile.avatar;
  }
  user.lastLoginAt = new Date();
  await user.save();

  const token = issueSession(res, user);
  res.json({ success: true, token, user: sanitizeUser(user) });
});

// Production phone login: the client verifies the OTP with Firebase and sends
// us the resulting ID token. We verify it and exchange it for our own session —
// the same pattern as googleLogin above.
const firebasePhoneLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) throw ApiError.badRequest('idToken is required');

  const { firebaseUid, phone } = await verifyFirebaseIdToken(idToken);

  let user = await User.findOne({ $or: [{ firebaseUid }, { phone }] });
  if (!user) {
    user = await User.create({ phone, firebaseUid });
  } else if (!user.firebaseUid) {
    user.firebaseUid = firebaseUid;
    if (!user.phone) user.phone = phone;
  }
  user.lastLoginAt = new Date();
  await user.save();

  const token = issueSession(res, user);
  res.json({ success: true, token, user: sanitizeUser(user) });
});

const requestOtp = asyncHandler(async (req, res) => {
  const { phone } = req.body;
  const result = await otpService.createOtp(phone);
  res.json({ success: true, message: 'OTP sent', ...result });
});

const verifyOtpLogin = asyncHandler(async (req, res) => {
  const { phone, code } = req.body;
  const result = await otpService.verifyOtp(phone, code);
  if (!result.ok) throw ApiError.badRequest(result.reason);

  let user = await User.findOne({ phone });
  if (!user) user = await User.create({ phone });
  user.lastLoginAt = new Date();
  await user.save();

  const token = issueSession(res, user);
  res.json({ success: true, token, user: sanitizeUser(user) });
});

const me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: sanitizeUser(req.user) });
});

const updateProfile = asyncHandler(async (req, res) => {
  const { name, email } = req.body;
  if (name !== undefined) req.user.name = name;
  if (email !== undefined) req.user.email = email;
  await req.user.save();
  res.json({ success: true, user: sanitizeUser(req.user) });
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out' });
});

const addAddress = asyncHandler(async (req, res) => {
  const address = req.body;
  if (req.user.addresses.length === 0) address.isDefault = true;
  if (address.isDefault) req.user.addresses.forEach((a) => { a.isDefault = false; });
  req.user.addresses.push(address);
  await req.user.save();
  res.status(201).json({ success: true, addresses: req.user.addresses });
});

const updateAddress = asyncHandler(async (req, res) => {
  const address = req.user.addresses.id(req.params.addressId);
  if (!address) throw ApiError.notFound('Address not found');
  if (req.body.isDefault) req.user.addresses.forEach((a) => { a.isDefault = false; });
  Object.assign(address, req.body);
  await req.user.save();
  res.json({ success: true, addresses: req.user.addresses });
});

const deleteAddress = asyncHandler(async (req, res) => {
  const address = req.user.addresses.id(req.params.addressId);
  if (!address) throw ApiError.notFound('Address not found');
  address.deleteOne();
  await req.user.save();
  res.json({ success: true, addresses: req.user.addresses });
});

const validators = {
  requestOtp: [
    body('phone').trim().matches(/^\+?[0-9]{7,15}$/).withMessage('Enter a valid phone number'),
  ],
  verifyOtp: [
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('code').trim().isLength({ min: 4, max: 8 }).withMessage('Enter the OTP you received'),
  ],
  address: [body('fullAddress').trim().notEmpty().withMessage('Full address is required')],
};

module.exports = {
  googleLogin,
  firebasePhoneLogin,
  requestOtp,
  verifyOtpLogin,
  me,
  updateProfile,
  logout,
  addAddress,
  updateAddress,
  deleteAddress,
  validators,
};
