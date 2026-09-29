const DEFAULT_UPI = {
  defaultUpiRecipientId: 'harshita',
  upiRecipients: [
    { id: 'harshita', name: 'Harshita', upiId: 'harshi.menghani-1@okaxis', payeeName: 'Harshita Menghani' },
    { id: 'omkar', name: 'Omkar', upiId: 'omkarbacha25-2@oksbi', payeeName: 'Omkar Baacha' },
    { id: 'aarchita', name: 'Aarchita', upiId: 'aarchita.menghani@okaxis', payeeName: 'Aarchita Menghani' },
  ],
};
const UPI_ID_PATTERN = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9._-]{1,63}$/;
module.exports = { DEFAULT_UPI, UPI_ID_PATTERN };
