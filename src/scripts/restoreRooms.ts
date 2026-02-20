import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function restoreRooms() {
    await mongoose.connect(process.env.MONGODB_URI!);
    const col = mongoose.connection.db!.collection('Data_Collection_Pre-Hackthon_1');

    const r1 = await col.updateOne({ teamName: 'spark x' }, { $set: { roomNumber: '2023btech034' } });
    console.log('spark x restored:', r1.modifiedCount);

    const r2 = await col.updateOne({ teamName: 'Jklufi' }, { $set: { roomNumber: 'EB2' } });
    console.log('Jklufi restored:', r2.modifiedCount);

    const r3 = await col.updateOne({ teamName: 'Dream debugger' }, { $set: { roomNumber: 'EB02-205' } });
    console.log('Dream debugger restored:', r3.modifiedCount);

    console.log('All restored!');
    await mongoose.disconnect();
    process.exit(0);
}

restoreRooms().catch(e => { console.error(e); process.exit(1); });
