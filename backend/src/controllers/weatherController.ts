/**
 * Weather Controller
 * Handles /api/weather/* routes.
 */

import type { Request, Response } from 'express';
import { fetchWeatherRange, getCurrentWeather } from '../services/weatherService.js';
import prisma from '../config/postgres.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toISO  = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (n: number): string => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };
const today  = (): string => toISO(new Date());

/** Subset of User fields the controller reads. AuthedUser-typed in global.d.ts. */
type WeatherUser = {
  id: string;
  storeLatitude: number | null;
  storeLongitude: number | null;
  storeTimezone: string | null;
  storeAddress: string | null;
};

/**
 * GET /api/weather/range?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export const getWeatherRange = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from = daysAgo(30), to = today() } = req.query as { from?: string; to?: string };
    const user = req.user as unknown as WeatherUser;

    if (user.storeLatitude == null || user.storeLongitude == null) {
      res.status(400).json({
        error: 'Store location not configured. Please set your store latitude/longitude in settings.',
        code: 'NO_STORE_LOCATION',
      });
      return;
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
    const message = err instanceof Error ? err.message : String(err);
    console.error('✗ Weather range error:', message);
    res.status(500).json({ error: message });
  }
};

/**
 * GET /api/weather/current
 */
export const getWeatherCurrent = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as unknown as WeatherUser;

    if (user.storeLatitude == null || user.storeLongitude == null) {
      res.status(400).json({
        error: 'Store location not configured.',
        code: 'NO_STORE_LOCATION',
      });
      return;
    }

    const weather = await getCurrentWeather(
      user.storeLatitude,
      user.storeLongitude,
      user.storeTimezone || 'America/New_York',
    );

    if (!weather) {
      res.status(503).json({ error: 'Weather service temporarily unavailable.' });
      return;
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
    const message = err instanceof Error ? err.message : String(err);
    console.error('✗ Current weather error:', message);
    res.status(500).json({ error: message });
  }
};

interface UpdateLocationBody {
  latitude?: number;
  longitude?: number;
  timezone?: string;
  address?: string | null;
}

/**
 * PUT /api/weather/store-location
 */
export const updateStoreLocation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { latitude, longitude, timezone, address } = req.body as UpdateLocationBody;

    if (latitude == null || longitude == null) {
      res.status(400).json({ error: 'latitude and longitude are required.' });
      return;
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      res.status(400).json({ error: 'Invalid coordinates.' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
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
    const message = err instanceof Error ? err.message : String(err);
    console.error('✗ Update store location error:', message);
    res.status(500).json({ error: message });
  }
};

/**
 * GET /api/weather/store-location
 */
export const getStoreLocation = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as unknown as WeatherUser;
    res.json({
      storeLatitude:  user.storeLatitude,
      storeLongitude: user.storeLongitude,
      storeTimezone:  user.storeTimezone,
      storeAddress:   user.storeAddress,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
};
