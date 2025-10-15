require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const { initializeDatabase } = require('./database');

app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/protected', require('./routes/protected'));
app.use('/api/notreallysuperadmin', require('./routes/superAdmin'));
app.use('/api/event', require('./routes/event'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/subjects', require('./routes/subjects'));
app.use('/api/results', require('./routes/results'));
app.use('/api/exams', require('./routes/exams'));
app.use('/api/enrollment', require('./routes/enrollment'));
app.use('/api/parents', require('./routes/parents'));
app.use('/api/students', require('./routes/students'));
app.use('/api/timetables', require('./routes/timetables'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/broadcasts', require('./routes/broadcasts'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/bookshop', require('./routes/bookshop'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/terms', require('./routes/terms'));
app.use('/api/fees', require('./routes/fees'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/make-payment', require('./routes/make-payment'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/ai', require('./routes/aiSummary'));
app.use('/api/library', require('./routes/library'));
app.use('/api/hospital', require('./routes/hospital'));

app.get('/', (req, res) => {
    res.json({ message: 'Hello World!' });
});

const PORT = process.env.PORT || 3000;

// Start the server after ensuring the database is initialized
async function startServer() {
    await initializeDatabase();
    app.listen(PORT, () => {
        console.log(`Node server running on port ${PORT}`);
    });
}

startServer();
