/**
 * Weather Controller
 * Handles /api/weather/* routes.
 */

import { fetchWeatherRange, getCurrentWeather } from '../services/weatherService.js';
import prisma from '../config/postgres.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toISO  = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };
const today  = () => toISO(new Date());

/**
 * GET /api/weather/range?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export const getWeatherRange = async (req, res) => {
  try {
    const { from = daysAgo(30), to = today() } = req.query;
    const user = req.user;

    if (!user.storeLatitude || !user.storeLongitude) {
      return res.status(400).json({
        error: 'Store location not configured. Please set your store latitude/longitude in settings.',
        code: 'NO_STORE_LOCATION',
      });
    }

    const weather = await fetchWeatherRange(
      user.storeLatitude,
      user.storeLongitude,
      from,
      to,
      user.storeTimezone || 'America/New_York',
    );

    res.json({
      location: {
        latitude:  user.storeLatitude,
        longitude: user.storeLongitude,
        timezone:  user.storeTimezone,
        address:   user.storeAddress,
      },
      from,
      to,
      count: weather.length,
      data:  weather,
    });
  } catch (err) {
    console.error('✗ Weather range error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/weather/current
 */
export const getWeatherCurrent = async (req, res) => {
  try {
    const user = req.user;

    if (!user.storeLatitude || !user.storeLongitude) {
      return res.status(400).json({
        error: 'Store location not configured.',
        code: 'NO_STORE_LOCATION',
      });
    }

    const weather = await getCurrentWeather(
      user.storeLatitude,
      user.storeLongitude,
      user.storeTimezone || 'America/New_York',
    );

    if (!weather) {
      return res.status(503).json({ error: 'Weather service temporarily unavailable.' });
    }

    res.json({
      location: {
        latitude:  user.storeLatitude,
        longitude: user.storeLongitude,
        address:   user.storeAddress,
      },
      ...weather,
    });
  } catch (err) {
    console.error('✗ Current weather error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /api/weather/store-location
 */
export const updateStoreLocation = async (req, res) => {
  try {
    const { latitude, longitude, timezone, address } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'latitude and longitude are required.' });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({ error: 'Invalid coordinates.' });
    }

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        storeLatitude:  latitude,
        storeLongitude: longitude,
        storeTimezone:  timezone || 'America/New_York',
        storeAddress:   address  || null,
      },
    });

    res.json({
      message:       'Store location updated successfully.',
      storeLatitude:  user.storeLatitude,
      storeLongitude: user.storeLongitude,
      storeTimezone:  user.storeTimezone,
      storeAddress:   user.storeAddress,
    });
  } catch (err) {
    console.error('✗ Update store location error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/weather/store-location
 */
export const getStoreLocation = async (req, res) => {
  try {
    res.json({
      storeLatitude:  req.user.storeLatitude,
      storeLongitude: req.user.storeLongitude,
      storeTimezone:  req.user.storeTimezone,
      storeAddress:   req.user.storeAddress,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
