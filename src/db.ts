import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env');
}

// Global interface to prevent TS errors on global.mongoose
declare global {
    var mongoose: { conn: mongoose.Connection | null; promise: Promise<mongoose.Mongoose> | null };
}

let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

export const connectDB = async (): Promise<mongoose.Connection> => {
    if (cached.conn) {
        return cached.conn;
    }

    if (!cached.promise) {
        const opts = {
            bufferCommands: false,
        };

        cached.promise = mongoose.connect(MONGO_URI, opts).then((mongoose) => {
            console.log('✅ New MongoDB connection established');
            return mongoose;
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (e) {
        cached.promise = null;
        throw e;
    }

    // cached.conn is actually the Mongoose instance, but compatible with Connection for basic usage or we return mongoose
    return cached.conn as unknown as mongoose.Connection;
};
