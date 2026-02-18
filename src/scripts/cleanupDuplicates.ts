import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Team } from '../models/Team';

dotenv.config();

async function cleanupDuplicates() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI not set in .env');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected to MongoDB\n');

    // Find all Ghost Protocol duplicates (case-insensitive match)
    const duplicates = await Team.find({
        teamName: { $regex: /^ghost\s*protocol$/i },
    }).sort({ createdAt: 1 }); // oldest first

    console.log(`Found ${duplicates.length} "Ghost Protocol" team(s):`);
    for (const t of duplicates) {
        console.log(`  - "${t.teamName}" (ID: ${t._id}, Created: ${t.createdAt})`);
    }

    if (duplicates.length <= 1) {
        console.log('\nNo duplicates to remove.');
        await mongoose.disconnect();
        return;
    }

    // Keep the first (oldest) one, delete the rest
    const keep = duplicates[0];
    const toDelete = duplicates.slice(1);

    console.log(`\n✅ Keeping: "${keep.teamName}" (ID: ${keep._id})`);
    console.log(`🗑️  Deleting ${toDelete.length} duplicate(s)...`);

    for (const t of toDelete) {
        await Team.deleteOne({ _id: t._id });
        console.log(`   Deleted: "${t.teamName}" (ID: ${t._id})`);
    }

    console.log('\n✅ Cleanup complete!');

    // Verify final count
    const remaining = await Team.countDocuments({});
    console.log(`Total teams remaining: ${remaining}`);

    await mongoose.disconnect();
}

cleanupDuplicates().catch(console.error);
