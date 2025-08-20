require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const con = require('./database');

app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/protected', require('./routes/protected'));
app.use('/api/notreallysuperadmin', require('./routes/superAdmin'));
app.use('/api/event', require('./routes/event'));
app.use('/api/branches', require('./routes/branches'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/exams', require('./routes/exams'));
app.use('/api/enrollment', require('./routes/enrollment'));
app.use('/api/parents', require('./routes/parents'));
app.use('/api/students', require('./routes/students'));
app.use('/api/timetables', require('./routes/timetables'));
app.use('/api/assignments', require('./routes/assignments'));
app.use('/api/broadcasts', require('./routes/broadcasts'));
app.use('/api/attendance', require('./routes/attendance'));

app.get('/', (req, res) => {
    res.json({ message: 'Hello World!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Node server running on port ${PORT}`);
});
