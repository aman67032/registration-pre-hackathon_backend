import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { User } from '../models/User';

dotenv.config();

const ADMIN_EMAIL = 'counciloftechnicalaffairs@jklu.edu.in';
const ADMIN_PASSWORD = 'Asujam@67';

async function seedAdmin() {
    try {
        const MONGO_URI = process.env.MONGODB_URI;

        if (!MONGO_URI) {
            throw new Error('MONGODB_URI is not defined in .env file');
        }

        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Check if admin already exists
        const existingAdmin = await User.findOne({ email: ADMIN_EMAIL });

        if (existingAdmin) {
            console.log('ℹ️  Admin user already exists:', ADMIN_EMAIL);
            console.log('✅ No action needed');
        } else {
            // Hash the password
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

            // Create admin user
            const adminUser = new User({
                email: ADMIN_EMAIL,
                password: hashedPassword,
                role: 'admin',
            });

            await adminUser.save();
            console.log('✅ Admin user created successfully!');
            console.log('📧 Email:', ADMIN_EMAIL);
            console.log('🔑 Password:', ADMIN_PASSWORD);
        }

        await mongoose.connection.close();
        console.log('👋 Database connection closed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding admin user:', error);
        process.exit(1);
    }
}

seedAdmin();
