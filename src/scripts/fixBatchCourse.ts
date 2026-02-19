import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
    throw new Error('Please define the MONGODB_URI environment variable inside .env');
}

async function fixBatchCourseData() {
    await mongoose.connect(MONGO_URI!);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db!;
    const collection = db.collection('Data_Collection_Pre-Hackthon_1');

    // 1. Fix "2024(HSB)" batch entries → batch "2024", course "HSB"
    // For leader fields:
    const leaderHSBResult = await collection.updateMany(
        { leaderBatch: '2024(HSB)' },
        { $set: { leaderBatch: '2024', leaderCourse: 'HSB' } }
    );
    console.log(`✅ Fixed ${leaderHSBResult.modifiedCount} leader(s) with batch "2024(HSB)" → batch "2024", course "HSB"`);

    // For member fields (embedded array):
    const teamsWithHSBMembers = await collection.find({
        'members.batch': '2024(HSB)'
    }).toArray();

    let memberHSBCount = 0;
    for (const team of teamsWithHSBMembers) {
        let changed = false;
        for (const member of team.members) {
            if (member.batch === '2024(HSB)') {
                member.batch = '2024';
                member.course = 'HSB';
                changed = true;
                memberHSBCount++;
            }
        }
        if (changed) {
            await collection.updateOne(
                { _id: team._id },
                { $set: { members: team.members } }
            );
        }
    }
    console.log(`✅ Fixed ${memberHSBCount} member(s) with batch "2024(HSB)" → batch "2024", course "HSB"`);

    // 2. Fix "2028" batch entries → "2024"
    // For leader fields:
    const leaderBatchResult = await collection.updateMany(
        { leaderBatch: '2028' },
        { $set: { leaderBatch: '2024' } }
    );
    console.log(`✅ Fixed ${leaderBatchResult.modifiedCount} leader(s) with batch "2028" → "2024"`);

    // For member fields:
    const teamsWithWrongBatch = await collection.find({
        'members.batch': '2028'
    }).toArray();

    let memberBatchCount = 0;
    for (const team of teamsWithWrongBatch) {
        let changed = false;
        for (const member of team.members) {
            if (member.batch === '2028') {
                member.batch = '2024';
                changed = true;
                memberBatchCount++;
            }
        }
        if (changed) {
            await collection.updateOne(
                { _id: team._id },
                { $set: { members: team.members } }
            );
        }
    }
    console.log(`✅ Fixed ${memberBatchCount} member(s) with batch "2028" → "2024"`);

    console.log('\n🎉 All batch/course fixes applied successfully!');
    await mongoose.disconnect();
    process.exit(0);
}

fixBatchCourseData().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
});
