import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function fixEdgeCases() {
    await mongoose.connect(process.env.MONGODB_URI!);
    const db = mongoose.connection.db!;
    const col = db.collection('Data_Collection_Pre-Hackthon_1');

    // Fix EB02-205 -> EB2 - 205
    const r1 = await col.updateMany({ roomNumber: 'EB02-205' }, { $set: { roomNumber: 'EB2 - 205' } });
    console.log(`EB02-205 fixed: ${r1.modifiedCount}`);

    // Fix 2023btech034 (roll number used as room) -> remove
    const r2 = await col.updateMany({ roomNumber: '2023btech034' }, { $set: { roomNumber: '' } });
    console.log(`2023btech034 fixed: ${r2.modifiedCount}`);

    // Fix EB2 alone (no room) -> remove
    const r3 = await col.updateMany({ roomNumber: 'EB2' }, { $set: { roomNumber: '' } });
    console.log(`EB2 alone fixed: ${r3.modifiedCount}`);

    // Fix EB1 105 -> EB1 - 105
    const r4 = await col.updateMany({ roomNumber: 'EB1 105' }, { $set: { roomNumber: 'EB1 - 105' } });
    console.log(`EB1 105 fixed: ${r4.modifiedCount}`);

    console.log('Done!');
    await mongoose.disconnect();
    process.exit(0);
}

fixEdgeCases().catch(e => { console.error(e); process.exit(1); });
